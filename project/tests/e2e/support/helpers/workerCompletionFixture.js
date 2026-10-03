const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { copyFramework } = require('./frameworkCopy')
const { stripAnsi } = require('./capturedOutput')

const ROOT = '/tmp/e2e-worker-completion'
const E2E = 'project/tests/e2e'
const JUNIT = E2E + '/_output/junit'
const CONFIG = E2E + '/codecept.conf.js'
const NATIVE = '/usr/local/bin/codeceptjs run-workers 2 --features --by pool --config ' + CONFIG
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
  if (process.env.WORKER_PROBE_FAIL === '1') require('assert/strict').fail('Previous launch: the greeting is missing')
})
Then('the worker completes example {int}', number => {
  require('assert/strict').ok(number === 1 || number === 2)
})
Then('the excluded scenario must never run', () => {
  throw new Error('TASK_CODECEPTJS_FEATURES selected an excluded feature')
})
`

function quote (text) {
  return "'" + text.replace(/'/g, "'\\''") + "'"
}

function environment (stop, features = SELECTED) {
  const env = { ...process.env, WORKER_PROBE_STOP: stop ? '1' : '0', TASK_CODECEPTJS_FEATURES: features, FORCE_COLOR: '0' }
  delete env.TASK_CODECEPTJS_GREP
  delete env.TASK_E2E_UPDATE_BASELINES
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
  fs.rmSync(ROOT, { recursive: true, force: true })
  fs.mkdirSync(ROOT, { recursive: true })
  copyFramework(ROOT)
  fs.symlinkSync('/app/.config/codeceptjs/node_modules', path.join(ROOT, '.config/codeceptjs/node_modules'))
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
  const source = run('cat ' + E2E + '/features/worker-stopped.feature ' + E2E +
    '/features/worker-completed.feature ' + E2E + '/support/steps/worker-probe.js', environment(false))
  assert.equal(source.code, 0, source.output)
  return source
}

function taskCommand (env, options = '') {
  const preview = run('task --dry project:test:e2e TASK_E2E_WORKERS=2 -- ' + options, env)
  assert.equal(preview.code, 0, preview.output)
  const line = preview.output.split('\n').find(line => line.includes('codeceptjs run-workers'))
  assert.ok(line, 'The task preview did not expose its real engine command:\n' + preview.output)
  const service = line.indexOf('codeceptjs ')
  return line.slice(service + 'codeceptjs '.length).trim()
}

function reportSnapshot () {
  const dir = path.join(ROOT, JUNIT)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).sort().map(name => ({ name, xml: fs.readFileSync(path.join(dir, name), 'utf8') }))
}

function seedReports (env) {
  fs.rmSync(path.join(ROOT, JUNIT), { recursive: true, force: true })
  const result = run(NATIVE, { ...env, WORKER_PROBE_STOP: '0' })
  assert.equal(result.code, 0, result.output)
  const reports = reportSnapshot()
  assert.ok(reports.some(report => report.xml.includes('@worker-stop')), 'The seed must contain a genuine earlier success for the interrupted scenario')
  return reports
}

function nativeRun (env, name) {
  const file = 'worker-' + name + '.log'
  const result = run(NATIVE + ' > ' + file, env)
  result.output = fs.readFileSync(path.join(ROOT, file), 'utf8')
  result.excerpt = run("sed -n '/^\\[Main\\] Worker exited/,+1p' " + file + '; tail -n 2 ' + file, env)
  assert.equal(result.excerpt.code, 0, result.excerpt.output)
  return result
}

function runInterruptedCases () {
  const cases = []
  for (const [name, features] of [['empty', './features/worker-stopped.feature'], ['partial', SELECTED]]) {
    const env = environment(true, features)
    fs.rmSync(path.join(ROOT, JUNIT), { recursive: true, force: true })
    const native = nativeRun(env, name)
    assert.match(native.output, /Worker exited with code 23/, native.output)
    assert.match(native.output, name === 'partial' ? /2 passed/ : /0 passed/, native.output)
    const current = reportSnapshot()
    assert.equal(current.some(report => report.xml.includes('@worker-stop')), false,
      'The stopped scenario must have no completion record in this actual run')
    const previous = seedReports(env)
    const guarded = run(taskCommand(env), env)
    const proof = path.join(global.codecept_dir, '_output/worker-completion')
    fs.mkdirSync(proof, { recursive: true })
    fs.writeFileSync(path.join(proof, name + '-native.log'), native.output)
    fs.writeFileSync(path.join(proof, name + '-guarded.log'), guarded.output)
    fs.writeFileSync(path.join(proof, name + '-earlier-reports.json'), JSON.stringify(previous, null, 2) + '\n')
    cases.push({ name, native, previous, guarded, reports: reportSnapshot() })
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

function runCompletedSelections () {
  const results = []
  for (const option of ['--grep ' + quote('@worker-ok'), '--grep ' + quote('@worker-stop') + ' --invert']) {
    const env = environment(true)
    seedReports(env)
    const result = run(taskCommand(env, option), env)
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /Worker completion: PASS \(2\/2 selected scenarios\)/, result.output)
    const reports = reportSnapshot()
    assert.equal(reports.some(report => report.xml.includes('@worker-stop')), false)
    assert.equal(reports.reduce((count, report) => count + (report.xml.match(/<testcase /g) || []).length, 0), 2,
      'Both Outline examples, and only the selected examples, must complete')
    results.push(result)
  }
  return results
}

function transcript (result, verdictOnly = false) {
  if (result.excerpt) {
    return '$ ' + result.command + '\n$ echo $?\n' + result.code + '\n$ ' + result.excerpt.command + '\n' +
      result.excerpt.output.trimEnd().replace(/\/\/ \d+(\.\d+)?m?s/g, '// <duration>')
  }
  const output = stripAnsi(result.output).replace(/\r/g, '').trimEnd()
  const start = verdictOnly ? output.indexOf('Worker completion:') : output.indexOf('[Main] Worker exited')
  const visible = start < 0 ? output : output.slice(start)
  return '$ ' + result.command + '\n' + visible
    .replace(/\[\d+\]/g, '[worker]')
    .replace(/\/\/ \d+(\.\d+)?m?s/g, '// <duration>')
    .replace(/\s+\(\d+(\.\d+)?m?s\)/g, ' (<duration>)') + '\n$ echo $?\n' + result.code
}

function removeWorkerFixture () {
  fs.rmSync(ROOT, { recursive: true, force: true })
}

function seedFailedLaunch () {
  prepareWorkerFixture()
  const env = { ...environment(false), WORKER_PROBE_FAIL: '1' }
  const command = taskCommand(env, '--grep @worker-stop')
  const result = run(command, env)
  assert.notEqual(result.code, 0, result.output)
  assert.ok(reportSnapshot().some(report => report.xml.includes('Previous launch: the greeting is missing')),
    'The previous launch must really fail and record its assertion')
  const proof = run('task devsecops:test:check:red-is-real -- @worker-stop', env)
  assert.equal(proof.code, 0, proof.output)
  return proof
}

function crashBeforeScenarios () {
  const env = environment(false)
  const command = taskCommand(env, '--grep @worker-stop')
  fs.appendFileSync(path.join(ROOT, CONFIG), '\nthrow new Error("Freshness probe: config failed before execution")\n')
  const result = run(command, env)
  assert.notEqual(result.code, 0, result.output)
  assert.match(result.output, /Freshness probe: config failed before execution/)
  return result
}

function redAfterCrash () {
  const result = run('task devsecops:test:check:red-is-real -- @worker-stop', environment(false))
  assert.notEqual(result.code, 0, 'A config crash reused an earlier failed report as RED evidence:\n' + stripAnsi(result.output))
  assert.deepEqual(reportSnapshot(), [], 'A previous worker report survived the config crash')
  assert.match(result.output, /no report at all/)
  return result
}

function zeroMatchSelection () {
  prepareWorkerFixture()
  const env = environment(false)
  seedReports(env)
  const result = run(taskCommand(env, '--grep @no-such-scenario'), env)
  assert.notEqual(result.code, 0, result.output)
  assert.match(result.output, /No Gherkin scenario matches this selection/)
  assert.deepEqual(reportSnapshot(), [], 'A zero-match selection retained earlier results')
  return result
}

module.exports = { prepareWorkerFixture, runInterruptedCases, assertInterruptedCases, runCompletedSelections, transcript, removeWorkerFixture, seedFailedLaunch, crashBeforeScenarios, redAfterCrash, zeroMatchSelection }
