/**
 * @worker-completion fixture: a throwaway copy of the framework whose only
 * features are two probes, run by the real engine and the repository's JUnit
 * reporter. One probe step ends its own worker process when WORKER_PROBE_STOP
 * is 1, the way a crash would.
 *
 * The cards type their lines in a real terminal (tdd-cycle.js); the functions
 * below are their twins: the same runs, off camera, checked on disk.
 */
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
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
  // The real engine and repository JUnit plugin need no browser to reproduce a
  // worker exiting. Only these probe steps load, so no other journey's cleanup
  // hook can run inside this disposable nested launch.
  fs.appendFileSync(path.join(ROOT, CONFIG),
    '\nexports.config.helpers = {}\nexports.config.include = {}\n' +
    "exports.config.gherkin.steps = ['./support/steps/worker-probe.js']\n" +
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
  removeWorkerFixture
}
