/**
 * @worker-completion fixture: a throwaway copy of the framework whose only
 * features are small probes, run by the real engine and the repository's JUnit
 * reporter. One probe step ends its own worker process when WORKER_PROBE_STOP
 * is 1, the way a crash would. The others repeat a scenario's name, skip a
 * scenario, sleep past the run's time limit or kill the whole engine.
 *
 * The cards type their lines in a real terminal (tdd-cycle.js); the functions
 * below are their twins: the same runs, off camera, checked on disk.
 */
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const { execSync, spawnSync } = require('child_process')
const { copyFrameworkWithEngine, engineCommand } = require('./frameworkCopy')

const ROOT = '/tmp/e2e-worker-completion'
const E2E = 'project/tests/e2e'
const JUNIT = E2E + '/_output/junit'
const CONFIG = E2E + '/codecept.conf.js'
const NATIVE = 'codeceptjs run-workers 2 --features --by pool --config ' + CONFIG
const SELECTED = './features/worker-stopped.feature,./features/worker-completed.feature'
const STOPPED = `Feature: Interrupted worker
  @worker-stop
  Scenario: a worker must finish its scenario
    Then the worker exits before completing when requested
`
const COMPLETED = `Feature: Completed worker
  @worker-ok
  Scenario Outline: the selected example <number> completes
    Then the worker completes example <number>
    Examples:
      | number |
      | 1      |
      | 2      |
`
const STEPS = `/* global Then */
Then('the worker exits before completing when requested', () => {
  if (process.env.WORKER_PROBE_STOP === '1') process.exit(23)
})
Then('the worker completes example {int}', number => {
  require('assert/strict').ok(number === 1 || number === 2)
})
Then('the excluded scenario must never run', () => {
  throw new Error('TASK_CODECEPTJS_FEATURES selected an excluded feature')
})
`

// The selection a CI shard would pass, exported on camera by the setup card
// (the rest of the session inherits it), and the three probe files: the third
// one is outside the selection.
const SETUP_LINE = `export TASK_CODECEPTJS_FEATURES=${SELECTED} WORKER_PROBE_STOP=1 && cat ${E2E}/features/worker-*.feature ${E2E}/support/steps/worker-probe.js`

// Ways a run can look complete without being complete. Each card shows its own
// probe, so none of these names matches the setup card's worker-* pattern.
const PROBES = {
  // The interrupted scenario's exact name, with a step that passes.
  'features/duplicate-title.feature': `Feature: Interrupted worker
  @worker-stop
  Scenario: a worker must finish its scenario
    Then the worker completes example 1
`,
  'features/skipped-scenario.feature': `Feature: Skipped scenario
  @worker-skip
  Scenario: a selected scenario must not be skipped
    Then the worker completes example 1
`,
  'support/steps/skip-hook.js': `/* global Before */
Before(test => {
  if (test.tags.includes('@worker-skip')) test.ctx.skip()
})
`,
  'features/suspended-worker.feature': `Feature: Suspended worker
  @worker-hang
  Scenario: a worker must not hang
    Then the worker sleeps for 60 seconds
`,
  'support/steps/sleep-step.js': `/* global Then */
Then('the worker sleeps for {int} seconds', seconds => new Promise(resolve => setTimeout(resolve, seconds * 1000)))
`,
  // Off camera only: a worker that takes the whole engine down with it.
  'features/lost-supervisor.feature': `Feature: Lost supervisor
  @worker-kill
  Scenario: the engine must outlive its workers
    Then the worker kills the whole engine
`,
  'support/steps/kill-engine.js': `/* global Then */
Then('the worker kills the whole engine', () => process.kill(process.pid, 'SIGKILL'))
`
}
const DUPLICATE = './features/worker-stopped.feature,./features/duplicate-title.feature'
const SKIPPED = './features/skipped-scenario.feature,./features/worker-completed.feature'
const SUSPENDED = './features/suspended-worker.feature,./features/worker-completed.feature'
// Long enough for the worker that runs the two examples to write its report,
// far shorter than the 60 seconds the other one sleeps.
const LIMIT = '15'

function environment (stop, features = SELECTED) {
  const env = { ...process.env, WORKER_PROBE_STOP: stop ? '1' : '0', TASK_CODECEPTJS_FEATURES: features, FORCE_COLOR: '0' }
  delete env.TASK_CODECEPTJS_GREP
  delete env.TASK_E2E_UPDATE_BASELINES
  delete env.CI
  return env
}

function run (command, env) {
  const result = spawnSync('sh', ['-c', command + ' 2>&1'], {
    cwd: ROOT, env, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024
  })
  if (result.error) throw result.error
  assert.equal(result.signal, null, 'The fixture command was interrupted: ' + result.signal)
  return { command, code: result.status, output: result.stdout }
}

function prepareWorkerFixture () {
  copyFrameworkWithEngine(ROOT)
  for (const [name, body] of [['stopped', STOPPED], ['completed', COMPLETED], ['excluded',
    'Feature: Outside this shard\n  Scenario: never selected\n    Then the excluded scenario must never run\n']]) {
    fs.writeFileSync(path.join(ROOT, E2E, 'features/worker-' + name + '.feature'), body)
  }
  fs.writeFileSync(path.join(ROOT, E2E, 'support/steps/worker-probe.js'), STEPS)
  for (const [name, body] of Object.entries(PROBES)) fs.writeFileSync(path.join(ROOT, E2E, name), body)
  const steps = ['worker-probe.js', ...Object.keys(PROBES).filter(name => name.endsWith('.js')).map(name => path.basename(name))]
  // The real engine and repository JUnit plugin need no browser to reproduce a
  // worker exiting. Only these probe steps load, so no other journey's cleanup
  // hook can run inside this disposable nested launch.
  fs.appendFileSync(path.join(ROOT, CONFIG),
    '\nexports.config.helpers = {}\nexports.config.include = {}\n' +
    `exports.config.gherkin.steps = ${JSON.stringify(steps.map(name => './support/steps/' + name))}\n` +
    "exports.config.plugins = { junit: { require: './support/junit-reporter.js', enabled: true } }\n")
}

const guarded = (options = '') => engineCommand(ROOT, environment(true), { workers: 2, args: options })

function reportSnapshot () {
  const dir = path.join(ROOT, JUNIT)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).sort().map(name => ({ name, xml: fs.readFileSync(path.join(dir, name), 'utf8') }))
}

// A genuine successful launch of every selected scenario, the interrupted one
// included: the earlier reports a later launch must not reuse.
function seedReports (env = environment(true)) {
  fs.rmSync(path.join(ROOT, JUNIT), { recursive: true, force: true })
  const result = run(NATIVE, { ...env, WORKER_PROBE_STOP: '0' })
  assert.equal(result.code, 0, result.output)
  const reports = reportSnapshot()
  assert.ok(reports.some(report => report.xml.includes('@worker-stop')), 'The seed must contain a genuine earlier success for the interrupted scenario')
  return reports
}

// The interrupted scenario alone, then beside the two examples: each run bare,
// then guarded right after a successful launch left its reports behind.
function runInterruptedCases () {
  const cases = []
  for (const [name, features] of [['empty', './features/worker-stopped.feature'], ['partial', SELECTED]]) {
    const env = environment(true, features)
    fs.rmSync(path.join(ROOT, JUNIT), { recursive: true, force: true })
    const native = run(NATIVE, env)
    assert.equal(native.code, 0, 'The bare engine is expected to exit 0 here, which is the hole the guard closes:\n' + native.output)
    assert.match(native.output, /Worker exited with code 23/, native.output)
    assert.match(native.output, name === 'partial' ? /2 passed/ : /0 passed/, native.output)
    assert.equal(reportSnapshot().some(report => report.xml.includes('@worker-stop')), false,
      'The stopped scenario must have no completion record in this actual run')
    const previous = seedReports(env)
    const guard = run(engineCommand(ROOT, env, { workers: 2 }), env)
    cases.push({ name, previous, guarded: guard, reports: reportSnapshot() })
  }
  return cases
}

function assertInterruptedCases (cases) {
  // Evaluate both runs before asserting either: the RED must demonstrate the
  // partial-success hole as well as a run with no completed scenario.
  const accepted = cases.filter(result => result.guarded.code === 0).map(result => result.name)
  assert.deepEqual(accepted, [], 'The task accepted interrupted workers: ' + accepted.join(', '))
  for (const result of cases) {
    assert.match(result.guarded.output, /Worker completion: FAIL/, result.guarded.output)
    assert.match(result.guarded.output, /missing: .*@worker-stop/, result.guarded.output)
    assert.equal(result.reports.some(report => report.xml.includes('@worker-stop')), false,
      'A previous successful report survived the current execution')
  }
}

// Both runs of one launch, side by side: the bare engine, its exit code and its
// own verdict; then the guarded command the task runs, its exit code and its
// verdict. Two workers print in any order, so each log goes to a file and only
// its last lines are read; the engine reports the lost worker on stderr, which
// stays on screen.
function interruptedLine () {
  return `${NATIVE} > engine.log; echo "exit code $?"; tail -n 1 engine.log; ` +
    `${guarded()} > guarded.log; echo "exit code $?"; tail -n 3 guarded.log`
}

function selectedLine () {
  return ['--grep @worker-ok', '--grep @worker-stop --invert']
    .map((option, i) => `${guarded(option)} > selected-${i + 1}.log; echo "exit code $?"; tail -n 2 selected-${i + 1}.log`)
    .join('; ')
}

// The twin of the selection card, read on screen and on disk: both selections
// pass, and the reports left behind hold the two examples and nothing else.
function assertSelectedReports (screen) {
  const rows = screen.split('\n').map(row => row.trim())
  assert.deepEqual(rows.filter(row => /^exit code \d+$/.test(row)), ['exit code 0', 'exit code 0'], screen)
  assert.equal(rows.filter(row => row === 'Worker completion: PASS (2/2 selected scenarios)').length, 2, screen)
  const reports = reportSnapshot()
  assert.equal(reports.some(report => report.xml.includes('@worker-stop')), false, 'An earlier report survived the selected run')
  assert.equal(reports.reduce((count, report) => count + (report.xml.match(/<testcase /g) || []).length, 0), 2,
    'Both Outline examples, and only the selected examples, must complete')
}

// A case card: its probe, then one selection run by the engine alone and by the
// guard, each verdict after its exit code. The subshell leaves the session's
// export as the setup card left it, for the cards after this one.
const show = (...names) => `cat ${names.map(name => `${E2E}/${name}`).join(' ')}; `
const engineAlone = log => `${NATIVE} > ${log}-engine.log; echo "exit code $?"; tail -n 1 ${log}-engine.log; `
const guardedRun = (log, lines) => `${guarded()} > ${log}.log; echo "exit code $?"; tail -n ${lines} ${log}.log`

function duplicateLine () {
  return show('features/duplicate-title.feature') +
    `(export TASK_CODECEPTJS_FEATURES=${DUPLICATE}; ${engineAlone('duplicate')}${guardedRun('duplicate', 2)})`
}

function skippedLine () {
  return show('features/skipped-scenario.feature', 'support/steps/skip-hook.js') +
    `(export TASK_CODECEPTJS_FEATURES=${SKIPPED}; ${engineAlone('skipped')}${guardedRun('skipped', 2)})`
}

// No engine-alone run here: it would only wait for the sleeping step. The last
// command lists the scenarios the report left on disk holds.
function suspendedLine () {
  return show('features/suspended-worker.feature', 'support/steps/sleep-step.js') +
    `(export TASK_CODECEPTJS_FEATURES=${SUSPENDED} TASK_E2E_TIMEOUT=${LIMIT}; ${guardedRun('suspended', 3)}); ` +
    `grep -ho 'testcase name="[^"]*"' ${JUNIT}/*.xml`
}

// The twin of a case card: the same selection, off camera, by the engine alone
// (unless it would only sleep) and by the guard, timed.
function runCase (features, { engine = true, ...extra } = {}) {
  const env = { ...environment(true, features), ...extra }
  const native = engine ? run(NATIVE, env) : null
  const command = engineCommand(ROOT, env, { workers: 2 })
  const started = Date.now()
  const guard = run(command, env)
  return { native, guard, seconds: (Date.now() - started) / 1000, reports: reportSnapshot() }
}

const testcases = reports => reports.flatMap(report =>
  [...report.xml.matchAll(/<testcase name="([^"]*)"/g)].map(match => match[1].replace(/\s+/g, ' ')))

function assertDuplicateCase () {
  const { native, guard } = runCase(DUPLICATE)
  assert.equal(native.code, 0, 'The engine alone is expected to exit 0 on the copy, the hole the guard closes:\n' + native.output)
  assert.match(native.output, /Worker exited with code 23/, native.output)
  assert.match(native.output, /OK\s+\|\s+1 passed\b/, native.output)
  assert.equal(guard.code, 1, 'The guard took the copy for the interrupted scenario:\n' + guard.output)
  assert.match(guard.output, /Ambiguous duplicate scenario title: Interrupted worker: a worker must finish its scenario @worker-stop/, guard.output)
}

function assertSkippedCase () {
  const { native, guard } = runCase(SKIPPED)
  assert.equal(native.code, 0, 'The engine alone is expected to exit 0 on a skip, the hole the guard closes:\n' + native.output)
  assert.match(native.output, /OK\s+\|\s+2 passed, 1 skipped/, native.output)
  assert.equal(guard.code, 1, 'The guard accepted a skipped scenario:\n' + guard.output)
  assert.match(guard.output, /Worker completion: FAIL \(2\/3 selected scenarios\)/, guard.output)
  assert.match(guard.output, /skipped: Skipped scenario: a selected scenario must not be skipped @worker-skip/, guard.output)
}

function assertSuspendedCases () {
  const hung = runCase(SUSPENDED, { engine: false, TASK_E2E_TIMEOUT: LIMIT })
  assert.equal(hung.guard.code, 1, 'The guard must stop a hanging run at TASK_E2E_TIMEOUT:\n' + hung.guard.output)
  assert.ok(hung.seconds < 45, `The guard waited ${hung.seconds} s, for the sleeping step instead of its ${LIMIT} s limit`)
  assert.match(hung.guard.output, /missing: Suspended worker: a worker must not hang @worker-hang/, hung.guard.output)
  assert.match(hung.guard.output, new RegExp(`engine exit: killed after ${LIMIT} s \\(TASK_E2E_TIMEOUT\\)`), hung.guard.output)
  assert.deepEqual(testcases(hung.reports), [1, 2].map(n => `Completed worker: the selected example ${n} completes @worker-ok`),
    'The report the other worker wrote must stay on disk for diagnosis')

  // A worker that takes the whole engine down, supervisor included.
  const lost = runCase('./features/lost-supervisor.feature', { engine: false })
  assert.equal(lost.guard.code, 1, 'The guard accepted a run whose engine was killed:\n' + lost.guard.output)
  assert.match(lost.guard.output, /missing: Lost supervisor: the engine must outlive its workers @worker-kill/, lost.guard.output)
  assert.match(lost.guard.output, /engine exit: signal SIGKILL/, lost.guard.output)

  // A limit the guard cannot read is refused, never ignored.
  const unread = runCase(SUSPENDED, { engine: false, TASK_E2E_TIMEOUT: '30m' })
  assert.equal(unread.guard.code, 1, unread.guard.output)
  assert.match(unread.guard.output, /TASK_E2E_TIMEOUT must be a whole number of seconds: 30m/, unread.guard.output)

  // The task hands the limit over to the test container.
  const preview = execSync('task --dry project:test:e2e 2>&1', { cwd: ROOT, env: { ...environment(false), TASK_E2E_TIMEOUT: LIMIT }, encoding: 'utf8' })
  assert.match(preview, new RegExp(`-e TASK_E2E_TIMEOUT='${LIMIT}' `), 'task project:test:e2e must pass TASK_E2E_TIMEOUT on:\n' + preview)
}

function removeWorkerFixture () {
  fs.rmSync(ROOT, { recursive: true, force: true })
}

module.exports = {
  ROOT,
  SETUP_LINE,
  prepareWorkerFixture,
  seedReports,
  runInterruptedCases,
  assertInterruptedCases,
  interruptedLine,
  selectedLine,
  assertSelectedReports,
  duplicateLine,
  assertDuplicateCase,
  skippedLine,
  assertSkippedCase,
  suspendedLine,
  assertSuspendedCases,
  removeWorkerFixture
}
