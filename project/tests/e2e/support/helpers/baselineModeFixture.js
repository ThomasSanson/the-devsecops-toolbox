/**
 * @baseline-mode fixture: a throwaway git copy of the framework whose only
 * feature compares one page with its committed reference, through both visual
 * helpers of the suite (the storyboard's assertOrUpdateBaseline and
 * pageVisual's assertPageVisualMatch). The references are captured blue; the
 * page the nested run captures is orange on its right half.
 *
 * The cards type their lines in a real terminal (tdd-cycle.js); the functions
 * below are the twins: the same facts, read on disk.
 */
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { copyFrameworkWithEngine } = require('./frameworkCopy')

const ROOT = '/tmp/e2e-baseline-mode'
const GIT_CONFIG = `${ROOT}.gitconfig`
const E2E = 'project/tests/e2e'
const HELPERS = ['storyboard', 'page']
const BRANCH = 'refresh-baselines'
const COMMIT = 'test: rewrite the baseline-probe references'
const HTML = '<!doctype html><html><body style="margin:32px;background:#20242b;color:white;font:24px monospace">' +
  '<main id="fixture" style="width:720px;padding:24px;background:#303640">' +
  '<h1 style="margin:0 0 24px;font-size:28px">A deliberate pixel change</h1>' +
  '<div style="display:flex;gap:24px"><div style="width:300px">Reference' +
  '<div style="height:160px;margin-top:16px;background:#2463eb"></div></div>' +
  '<div style="width:300px">Current' +
  '<div style="height:160px;margin-top:16px;background:CURRENT_COLOR"></div></div></div></main></body></html>'
const BLUE = HTML.replace('CURRENT_COLOR', '#2463eb')
const ORANGE = HTML.replace('CURRENT_COLOR', '#e05b24')

const PROBE_FEATURE = `@e2e
Feature: Comparing the captured pixels
  @baseline-probe
  Scenario Outline: the <helper> helper compares the page with its reference
    Then the <helper> helper compares the captured page with its reference
    Examples:
      | helper     |
      | storyboard |
      | page       |
`

const PROBE_STEPS = `/* global inject Then */
const fs = require('fs')
const path = require('path')
const { assertOrUpdateBaseline } = require('../../../../../.config/codeceptjs/storyboard')
const { assertPageVisualMatch } = require('../helpers/pageVisual')
const { I } = inject()

Then('the {word} helper compares the captured page with its reference', async (helper) => {
  const html = fs.readFileSync(path.join(__dirname, '../../baseline-probe.html'), 'utf8')
  await I.usePlaywrightTo('show the page under test', async ({ page }) => {
    await page.setContent(html)
  })
  const name = 'baseline-probe/' + helper
  if (helper === 'page') {
    await assertPageVisualMatch(I, name)
  } else {
    await I.takeScreenshot(name)
    await assertOrUpdateBaseline(I, name)
  }
})
`

const reference = (helper) => path.join(ROOT, E2E, 'screenshots/base/baseline-probe', helper + '.png')
const actual = (helper) => path.join(ROOT, E2E, '_output/baseline-probe', helper + '.png')

// The line of every card, the same for each value so the cards compare: what
// the task hands to the test container, the run and its exit code (only the
// verdict lines of the engine), and what git sees in the references.
function caseLine (prefix) {
  return `${prefix} task --dry project:test:e2e 2>&1 | grep -o "exec -T.* codeceptjs node"; ` +
    `${prefix} codeceptjs run --features --config ${E2E}/codecept.conf.js --grep @baseline-probe | grep -E "mismatch|forbidden|passed"; ` +
    `echo "exit code \${PIPESTATUS[0]}"; git status --short ${E2E}/screenshots`
}

async function prepareBaselineFixture (I, env) {
  copyFrameworkWithEngine(ROOT)
  fs.writeFileSync(path.join(ROOT, E2E, 'baseline-probe.html'), ORANGE)
  fs.writeFileSync(path.join(ROOT, E2E, 'features/baseline-probe.feature'), PROBE_FEATURE)
  fs.writeFileSync(path.join(ROOT, E2E, 'support/steps/baseline-probe.js'), PROBE_STEPS)
  // The same browser, visual helpers and plugins as the real suite. Load only
  // this probe so nested runs cannot execute other journeys' cleanup.
  fs.appendFileSync(path.join(ROOT, E2E, 'codecept.conf.js'),
    "\nexports.config.gherkin.features = './features/baseline-probe.feature'\n" +
    "exports.config.gherkin.steps = ['./support/steps/baseline-probe.js']\n")
  // The references: the same page, blue on both halves, captured at the size
  // the nested run captures (the suite's 1024x768 window).
  await I.resizeWindow(1024, 768)
  await I.usePlaywrightTo('capture the reference and show the changed page', async ({ page }) => {
    await page.setContent(BLUE)
    const blue = await page.screenshot()
    for (const helper of HELPERS) {
      fs.mkdirSync(path.dirname(reference(helper)), { recursive: true })
      fs.writeFileSync(reference(helper), blue)
    }
    await page.setContent(ORANGE)
  })
  fs.writeFileSync(GIT_CONFIG, '[safe]\n\tdirectory = *\n[user]\n\temail = lambda@test.local\n\tname = Lambda User\n[init]\n\tdefaultBranch = main\n')
  execSync('git init -q && git add -A && git commit -qm "the toolbox with its blue references"', { cwd: ROOT, env: { ...env, GIT_CONFIG_GLOBAL: GIT_CONFIG } })
}

const committed = (helper) => execSync(`git show HEAD:${E2E}/screenshots/base/baseline-probe/${helper}.png`, { cwd: ROOT, env: { ...process.env, GIT_CONFIG_GLOBAL: GIT_CONFIG } })

// The twin of one card: what the task forwards, the run's verdict, and the
// references on disk compared byte for byte with the commit and the capture.
function assertCase (screen, { value, ci }) {
  const forwarded = value === '1'
  const handed = screen.split('\n').map(row => row.trim()).find(row => row.startsWith('exec -T'))
  assert.ok(handed, `The task preview must show what it hands to the test container:\n${screen}`)
  assert.equal(handed.includes('-e TASK_E2E_UPDATE_BASELINES=1'), forwarded, `The task must forward the flag only for the exact value 1:\n${screen}`)
  assert.equal(handed.includes('-e CI='), forwarded && ci, `The task must tell the test container it runs in CI whenever it forwards the flag:\n${screen}`)
  const rewrite = forwarded && !ci
  if (rewrite) {
    assert.ok(screen.includes('OK  | 2 passed') && screen.includes('exit code 0'), `The value 1 must let both comparisons pass:\n${screen}`)
  } else {
    assert.ok(screen.includes('FAIL  | 0 passed, 2 failed') && screen.includes('exit code 1'), `Both comparisons must fail:\n${screen}`)
    const reason = ci ? 'TASK_E2E_UPDATE_BASELINES is forbidden in CI' : 'Visual mismatch: '
    assert.equal(screen.split(reason).length - 1, 2, `Both helpers must refuse with "${reason}":\n${screen}`)
  }
  for (const helper of HELPERS) {
    assert.ok(fs.existsSync(actual(helper)), `The engine did not capture the page for the ${helper} helper`)
    assert.notDeepEqual(fs.readFileSync(actual(helper)), committed(helper), 'The engine must compare genuinely different images')
    const now = fs.readFileSync(reference(helper))
    if (rewrite) assert.deepEqual(now, fs.readFileSync(actual(helper)), `The ${helper} helper did not write the captured pixels`)
    else assert.deepEqual(now, committed(helper), `The ${helper} helper rewrote its reference`)
  }
  const status = execSync(`git status --short ${E2E}/screenshots`, { cwd: ROOT, env: { ...process.env, GIT_CONFIG_GLOBAL: GIT_CONFIG }, encoding: 'utf8' }).trim()
  assert.equal(status.split('\n').filter(Boolean).length, rewrite ? 2 : 0, `git must see ${rewrite ? 'both references rewritten' : 'no change'}:\n${status}`)
}

// The rewritten references, committed on their own branch: what the developer
// pushes for review.
function commitRewrittenReferences () {
  execSync(`git switch -q -c ${BRANCH} && git commit -qam "${COMMIT}"`, { cwd: ROOT, env: { ...process.env, GIT_CONFIG_GLOBAL: GIT_CONFIG } })
}

function removeBaselineFixture () {
  fs.rmSync(ROOT, { recursive: true, force: true })
  fs.rmSync(GIT_CONFIG, { force: true })
}

module.exports = { ROOT, GIT_CONFIG, E2E, HELPERS, BRANCH, COMMIT, caseLine, prepareBaselineFixture, assertCase, commitRewrittenReferences, reference, removeBaselineFixture }
