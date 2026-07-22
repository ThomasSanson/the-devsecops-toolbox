/* global inject Given When Then */
/**
 * Storyboard-coverage gate DOGFOOD — @test-discipline.
 *
 * The gate (.config/devsecops/scripts/check-storyboard-coverage.sh) turns this
 * repo's key principle into teeth: on a merge request it FAILS when product
 * files changed with no storyboard card changed or added. The gate itself
 * touches .config/**, so by its own rule it owes a visible proof — this is it.
 *
 * Driven through the guard's documented STORYBOARD_COVERAGE_FILES seam (no git,
 * fully deterministic) with BASE pinned so the header line never drifts. ONE
 * Gherkin sentence = ONE card = ONE pixel baseline, asserted in-step
 * (tolerance: 0); each card twins its <pre> frame with the guard's REAL exit
 * code and verdict string, so a regression fails loud even without eyes.
 */
const { I } = inject()
const { execSync } = require('child_process')
const {
  renderPreFrame,
  stripAnsi,
  assertContains,
  assertZeroExit,
  assertNonZeroExit
} = require('../helpers/capturedOutput')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

// The full working-branch repo is tarred into /workspace inside the codeceptjs
// container (same as version-pins/copierRender), so the REAL guard lives here.
const REPO = '/workspace'
const GATE = '.config/devsecops/scripts/check-storyboard-coverage.sh'

// Real files, so the demo is concrete: a product file that must be proven, and
// a storyboard card that would prove a change touching it.
const PRODUCT = '.config/gitlab/ci/devsecops/release.yml'
const STORYBOARD = 'project/tests/e2e/features/02-daily-work/release-window.feature'

// Run the real guard through its seam. BASE is pinned to origin/main so the
// header stays deterministic even on an MR pipeline (where the codeceptjs
// container inherits a volatile CI_MERGE_REQUEST_DIFF_BASE_SHA).
function runGate (extraEnv) {
  const env = { ...process.env, BASE: 'origin/main', ...extraEnv }
  try {
    const out = execSync(`bash ${GATE}`, {
      cwd: REPO, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status == null ? 1 : e.status, out: `${e.stdout || ''}${e.stderr || ''}` }
  }
}

// The frame is the exact command a reviewer can copy-paste plus the guard's
// verbatim output (ANSI stripped for a clean, legible <pre>).
async function renderRun (frameName, envLine, extraEnv) {
  const result = runGate(extraEnv)
  const cmd = `$ ${envLine} bash ${GATE}`
  await renderPreFrame(I, frameName, `${cmd}\n${stripAnsi(result.out).trimEnd()}`)
  return result
}

storyboardStep(Given, 'a product file changes with no storyboard card, the gate stops the merge request', async () => {
  const r = await renderRun(
    'gate-stops-unproven',
    `BASE=origin/main STORYBOARD_COVERAGE_FILES='${PRODUCT}'`,
    { STORYBOARD_COVERAGE_FILES: PRODUCT }
  )
  assertNonZeroExit(r.code, r.out)
  assertContains(r.out, 'Product changed with NO storyboard')
  assertContains(r.out, PRODUCT)
})

storyboardStep(When, 'a storyboard card is added beside the same change, the gate lets it through', async () => {
  const r = await renderRun(
    'gate-passes-proven',
    `BASE=origin/main STORYBOARD_COVERAGE_FILES='${PRODUCT} ${STORYBOARD}'`,
    { STORYBOARD_COVERAGE_FILES: `${PRODUCT} ${STORYBOARD}` }
  )
  assertZeroExit(r.code, r.out)
  assertContains(r.out, 'a storyboard was changed/added')
  assertContains(r.out, STORYBOARD)
})

storyboardStep(Then, 'a deliberately invisible change is waived only by a visible Storyboard-exempt trailer', async () => {
  const r = await renderRun(
    'gate-waives-exempt',
    `BASE=origin/main STORYBOARD_EXEMPT=1 STORYBOARD_COVERAGE_FILES='${PRODUCT}'`,
    { STORYBOARD_EXEMPT: '1', STORYBOARD_COVERAGE_FILES: PRODUCT }
  )
  assertZeroExit(r.code, r.out)
  assertContains(r.out, "'Storyboard-exempt:' trailer waives the gate")
})
