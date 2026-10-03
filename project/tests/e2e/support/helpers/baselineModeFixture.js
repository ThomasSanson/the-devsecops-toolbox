const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { copyFramework } = require('./frameworkCopy')
const { stripAnsi } = require('./capturedOutput')

const ROOT = '/tmp/e2e-baseline-mode'
const E2E = 'project/tests/e2e'
const HELPERS = ['storyboard', 'page']
const HTML = '<!doctype html><html><body style="margin:32px;background:#20242b;color:white;font:24px monospace">' +
  '<main id="fixture" style="width:720px;padding:24px;background:#303640">' +
  '<h1 style="margin:0 0 24px;font-size:28px">A deliberate pixel change</h1>' +
  '<div style="display:flex;gap:24px"><div style="width:300px">Reference' +
  '<div style="height:160px;margin-top:16px;background:#2463eb"></div></div>' +
  '<div style="width:300px">Current' +
  '<div style="height:160px;margin-top:16px;background:CURRENT_COLOR"></div></div></div></main></body></html>'

const PROBE_STEPS = `/* global inject Then */
const fs = require('fs')
const path = require('path')
const { assertOrUpdateBaseline } = require('../../../../../.config/codeceptjs/storyboard')
const { assertPageVisualMatch } = require('../helpers/pageVisual')
const { I } = inject()

Then('the captured page matches its reference', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../../baseline-probe.html'), 'utf8')
    .replace('CURRENT_COLOR', process.env.BASELINE_PROBE_COLOR)
  await I.usePlaywrightTo('show the pixel comparison fixture', async ({ page }) => {
    await page.setContent(html)
  })
  const name = 'baseline-probe/' + process.env.BASELINE_PROBE_HELPER
  if (process.env.BASELINE_PROBE_HELPER === 'page') {
    await assertPageVisualMatch(I, name)
  } else {
    await I.takeScreenshot(name)
    await assertOrUpdateBaseline(I, name)
  }
})
`

function quote (value) {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

function run (command, env) {
  const result = spawnSync('sh', ['-c', 'exec 2>&1\nset -x\n' + command], {
    cwd: ROOT, env, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024
  })
  if (result.error) throw result.error
  return { code: result.status, output: (result.stdout || '') + (result.stderr || '') }
}

function caseEnvironment (value, ci) {
  const env = { ...process.env, FORCE_COLOR: '1', BASELINE_PROBE_COLOR: '#e05b24' }
  delete env.TASK_E2E_UPDATE_BASELINES
  delete env.TASK_CODECEPTJS_FEATURES
  delete env.TASK_CODECEPTJS_GREP
  delete env.CI
  if (value !== undefined) env.TASK_E2E_UPDATE_BASELINES = value
  if (ci) env.CI = 'true'
  return env
}

async function prepareBaselineFixture (I) {
  fs.rmSync(ROOT, { recursive: true, force: true })
  fs.mkdirSync(ROOT, { recursive: true })
  copyFramework(ROOT)
  fs.symlinkSync('/app/.config/codeceptjs/node_modules', path.join(ROOT, '.config/codeceptjs/node_modules'))
  fs.writeFileSync(path.join(ROOT, E2E, 'baseline-probe.html'), HTML)
  fs.writeFileSync(path.join(ROOT, E2E, 'features/baseline-probe.feature'),
    '@e2e\nFeature: Comparing the captured pixels\n  @baseline-probe\n' +
    '  Scenario: the changed page must be detected\n    Then the captured page matches its reference\n')
  fs.writeFileSync(path.join(ROOT, E2E, 'support/steps/baseline-probe.js'), PROBE_STEPS)
  // The same browser, visual helper and plugins as the real suite. Load only
  // this probe's steps so nested runs cannot execute other journeys' cleanup.
  fs.appendFileSync(path.join(ROOT, E2E, 'codecept.conf.js'),
    "\nexports.config.gherkin.features = './features/baseline-probe.feature'\n" +
    "exports.config.gherkin.steps = ['./support/steps/baseline-probe.js']\n")
  await I.resizeWindow(1024, 768)
  await I.usePlaywrightTo('capture the reference and show the changed pixels', async ({ page }) => {
    await page.setContent(HTML.replace('CURRENT_COLOR', '#2463eb'))
    await page.screenshot({ path: path.join(ROOT, 'reference.png') })
    await page.setContent(HTML.replace('CURRENT_COLOR', '#e05b24'))
    await page.screenshot({ path: path.join(ROOT, 'changed.png') })
  })
  assert.notDeepEqual(fs.readFileSync(path.join(ROOT, 'reference.png')),
    fs.readFileSync(path.join(ROOT, 'changed.png')), 'The fixture must contain a real pixel difference')
}

function baselinePath (helper) {
  return path.join(ROOT, E2E, 'screenshots/base/baseline-probe', helper + '.png')
}

function runBaselineCase (value, ci = false) {
  const env = caseEnvironment(value, ci)
  const preview = run('task --dry project:test:e2e > /tmp/e2e-baseline-forwarding.log 2>&1 && ' +
    "grep 'codeceptjs run-workers' /tmp/e2e-baseline-forwarding.log", env)
  const results = []
  for (const helper of HELPERS) {
    const baseline = baselinePath(helper)
    fs.mkdirSync(path.dirname(baseline), { recursive: true })
    fs.copyFileSync(path.join(ROOT, 'reference.png'), baseline)
    const before = fs.readFileSync(baseline)
    const result = run('sh -c ' + quote("env | sort | grep -E '^(BASELINE_PROBE_HELPER|CI|TASK_E2E_UPDATE_BASELINES)='") + '\n' +
      'codeceptjs run --features --config ' + E2E +
      '/codecept.conf.js --grep ' + quote('@baseline-probe'), { ...env, BASELINE_PROBE_HELPER: helper })
    const actual = path.join(ROOT, E2E, '_output/baseline-probe', helper + '.png')
    assert.ok(fs.existsSync(actual), 'The engine did not capture the changed page:\n' + result.output)
    assert.notDeepEqual(before, fs.readFileSync(actual), 'The engine must compare genuinely different captured images')
    results.push({
      helper,
      ...result,
      unchanged: before.equals(fs.readFileSync(baseline)),
      matchesActual: fs.readFileSync(baseline).equals(fs.readFileSync(actual))
    })
  }
  return { value, ci, preview, results }
}

function assertBaselineCase (result) {
  const { value, ci, preview, results } = result
  assert.equal(preview.code, 0, preview.output)
  assert.equal(preview.output.includes('-e TASK_E2E_UPDATE_BASELINES=1'), value === '1',
    'The task must forward baseline regeneration only for the exact value 1')
  for (const outcome of results) {
    const output = stripAnsi(outcome.output)
    if (value === '1' && !ci) {
      assert.equal(outcome.code, 0, outcome.output)
      assert.equal(outcome.unchanged, false, outcome.helper + ' did not regenerate the changed baseline')
      assert.equal(outcome.matchesActual, true, outcome.helper + ' did not persist the captured pixels')
    } else {
      assert.notEqual(outcome.code, 0, outcome.helper + ' accepted a real pixel difference with update=' + value)
      assert.equal(outcome.unchanged, true, outcome.helper + ' overwrote its baseline during a strict run')
      assert.match(output, ci ? /forbidden in CI/ : /Visual mismatch: [\d.]+% different/,
        'The run must fail on the intended visual check')
    }
  }
}

function proofOutput (result) {
  return [result.preview.output, ...result.results.map(item => item.output)].join('\n')
    .replace(/\b\d+(\.\d+)?m?s\b/g, '<duration>')
    .replace(/CodeceptJS v[0-9][0-9.]*/g, 'CodeceptJS v<version>')
    .replace(/browserVersion: [0-9.]+/g, 'browserVersion: <version>')
}

function removeBaselineFixture () {
  fs.rmSync(ROOT, { recursive: true, force: true })
  fs.rmSync('/tmp/e2e-baseline-forwarding.log', { force: true })
}

module.exports = { prepareBaselineFixture, runBaselineCase, assertBaselineCase, proofOutput, removeBaselineFixture }
