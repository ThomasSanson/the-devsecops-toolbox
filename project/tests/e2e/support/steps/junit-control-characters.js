/* global inject Before After Given When Then */
const assert = require('assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { copyFramework } = require('../helpers/frameworkCopy')
const { renderPreFrame } = require('../helpers/capturedOutput')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const { I } = inject()

const E2E = 'project/tests/e2e'
const FEATURE = `${E2E}/features/report-probe.feature`
const STEPS = `${E2E}/support/steps/report-probe.js`
const CONFIG = `${E2E}/codecept.conf.js`
const REPORT = `${E2E}/_output/junit/results-1.xml`
const PLAIN = 'Expected <hello> & "world", got café 🧪\nKeep this second line\tindented.\r'
const FEATURES = `Feature: JUnit report probe
  @report-pass
  Scenario: an ordinary scenario passes
    Then the ordinary probe passes
  @report-plain
  Scenario: an ordinary assertion fails
    Then the plain probe fails
  @report-colour
  Scenario: a coloured assertion fails
    Then the coloured probe fails
`
const PROBE_STEPS = `/* global Then */
const assert = require('assert/strict')
const message = ${JSON.stringify(PLAIN)}
const forbidden = Array.from({ length: 32 }, (_, code) => code)
  .filter(code => ![9, 10, 13].includes(code)).concat([65534, 65535])
  .map(code => String.fromCharCode(code)).join('')
Then('the ordinary probe passes', () => assert.equal(1 + 1, 2))
Then('the plain probe fails', () => assert.fail(message))
Then('the coloured probe fails', () => {
  const escape = String.fromCharCode(27)
  assert.fail(escape + '[31m' + message + escape + '[0m' + forbidden + 'Message ends here.')
})
`
const CHECK_XML = `import json
import xml.etree.ElementTree as ET
root = ET.parse('${REPORT}').getroot()
cases = list(root.iter('testcase'))
failures = [case.find('failure').get('message') for case in cases if case.find('failure') is not None]
print(json.dumps({'tests': len(cases), 'failures': failures, 'skipped': len(list(root.iter('skipped'))), 'errors': len(list(root.iter('error')))}, ensure_ascii=False, indent=2))
`
let root
let env

Before(() => { root = null })
After(() => { if (root) fs.rmSync(root, { recursive: true, force: true }) })

function run (command) {
  const result = spawnSync('sh', ['-c', command], {
    cwd: root, env, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024
  })
  if (result.error) throw result.error
  assert.equal(result.signal, null, 'The probe must finish')
  const output = result.stdout + result.stderr
  const dir = path.join(global.output_dir, 'junit-control-characters')
  fs.mkdirSync(dir, { recursive: true })
  const name = command.startsWith('python3') ? 'xml-reader' : command.startsWith('task devsecops:') ? 'red-guard' : command.startsWith('cat') ? 'setup' : 'engine'
  fs.writeFileSync(path.join(dir, name + '.stdout.log'), result.stdout)
  fs.writeFileSync(path.join(dir, name + '.stderr.log'), result.stderr)
  return { command, code: result.status, output }
}

function stable (text) {
  return text.split(root).join('<probe>')
    .replace(/\b\d+(?:\.\d+)?ms\b/g, '<duration>')
    .replace(/\/\/ \d+(?:\.\d+)?m?s/g, '// <duration>')
    .replace(/\[\d+\]/g, '[worker]')
    .replace(/"time":\s*\d+(?:\.\d+)?/g, '"time": <duration>')
}

async function frame (name, result) {
  await renderPreFrame(I, name, '$ ' + result.command + '\n' + stable(result.output) + '\n$ echo $?\n' + result.code, { colour: true, height: 3200 })
}

storyboardStep(Given, 'a disposable test project contains a passing scenario and plain and coloured failures', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-junit-controls-'))
  copyFramework(root)
  fs.symlinkSync('/app/.config/codeceptjs/node_modules', path.join(root, '.config/codeceptjs/node_modules'))
  env = { ...process.env, FORCE_COLOR: '1', TASK_CODECEPTJS_FEATURES: './features/report-probe.feature' }
  delete env.TASK_CODECEPTJS_GREP
  delete env.TASK_E2E_UPDATE_BASELINES
  fs.writeFileSync(path.join(root, FEATURE), FEATURES)
  fs.writeFileSync(path.join(root, STEPS), PROBE_STEPS)
  fs.writeFileSync(path.join(root, 'check-report.py'), CHECK_XML)
  fs.appendFileSync(path.join(root, CONFIG), '\nexports.config.helpers = {}\nexports.config.include = {}\n' +
    "exports.config.gherkin.steps = ['./support/steps/report-probe.js']\n" +
    "exports.config.plugins = { junit: { require: './support/junit-reporter.js', enabled: true } }\n")
  const source = run('cat ' + FEATURE + ' ' + STEPS + ' check-report.py')
  assert.equal(source.code, 0)
  await frame('setup', source)
})

storyboardStep(When, 'the real test task runs the passing scenario and both failures', async () => {
  const preview = run('task --dry project:test:e2e TASK_E2E_WORKERS=1')
  assert.equal(preview.code, 0, preview.output)
  const line = preview.output.split('\n').find(line => line.includes('codeceptjs run-workers'))
  assert.ok(line, 'The task preview must expose its real engine command')
  const command = line.slice(line.indexOf('codeceptjs ') + 'codeceptjs '.length).trim()
  const result = run(command)
  assert.notEqual(result.code, 0, 'Both assertion failures must fail the real run')
  assert.match(result.output, /1 passed/)
  assert.match(result.output, /2 failed/)
  assert.ok(fs.existsSync(path.join(root, REPORT)), 'The real reporter must write its results')
  const proof = path.join(global.output_dir, 'junit-control-characters/results.xml')
  fs.copyFileSync(path.join(root, REPORT), proof)
  await frame('real-failures', result)
})

storyboardStep(Then, 'the JUnit report is valid XML and keeps both failures readable', async () => {
  const result = run('python3 check-report.py')
  assert.equal(result.code, 0, 'The actual JUnit report must be valid XML:\n' + result.output)
  const parsed = JSON.parse(result.output)
  assert.equal(parsed.tests, 3)
  assert.equal(parsed.skipped, 0)
  assert.equal(parsed.errors, 0)
  assert.deepEqual(parsed.failures, [PLAIN, PLAIN + 'Message ends here.'])
  const xml = fs.readFileSync(path.join(root, REPORT), 'utf8')
  assert.equal(xml.includes(String.fromCharCode(27)), false, 'ANSI colours must not reach the XML')
  await frame('readable-report', result)
})

storyboardStep(Then, 'the RED guard still accepts the coloured assertion as a genuine failure', async () => {
  const result = run('task devsecops:test:check:red-is-real -- @report-colour')
  assert.equal(result.code, 0, result.output)
  assert.match(result.output, /the scenario ran and failed on its own check/)
  assert.match(result.output, /Expected <hello>/)
  await frame('real-red-proof', result)
})
