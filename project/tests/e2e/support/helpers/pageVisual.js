/**
 * Shared page-visual assert with a uniform baseline-regeneration mode.
 *
 * Normal mode: capture + assertVisualMatch (tolerance: 0).
 * TASK_E2E_UPDATE_BASELINES=1: assert first, and ONLY when the assert fails
 * write the freshly captured actual over screenshots/base/<name>.png — green
 * baselines are left byte-identical so a regeneration run produces no churn.
 * Every baseline written this way MUST be inspected by a human, which is why
 * the mode is refused in CI.
 */
/* global tryTo */
const fs = require('fs')
const path = require('path')

// tryTo: a plain try/catch around an actor call is NOT enough — the CodeceptJS
// recorder still marks the step (and thus the test) failed even when the
// awaiting code swallows the rejection. tryTo (exposed as a global by the
// enabled plugin — `codeceptjs` itself is not resolvable from the test tree)
// is the supported escape hatch.
const E2E_DIR = path.resolve(__dirname, '..', '..')

async function assertPageVisualMatch (I, baselineName) {
  // Force a fresh actual so the helper never compares a stale _output PNG.
  await I.takeScreenshot(baselineName)

  if (!process.env.TASK_E2E_UPDATE_BASELINES) {
    await I.assertVisualMatch(baselineName)
    return
  }

  if (process.env.CI) {
    throw new Error('TASK_E2E_UPDATE_BASELINES is forbidden in CI — baselines must be regenerated and inspected locally')
  }

  const matches = await tryTo(() => I.assertVisualMatch(baselineName))
  if (!matches) {
    const actualPath = path.join(E2E_DIR, '_output', baselineName + '.png')
    const baselinePath = path.join(E2E_DIR, 'screenshots', 'base', baselineName + '.png')
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true })
    fs.copyFileSync(actualPath, baselinePath)
  }
}

module.exports = { assertPageVisualMatch }
