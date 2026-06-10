/**
 * Shared text-to-pixel proof helper.
 *
 * Renders deterministic text (command output, file listings) as a dark
 * `<pre>` block in the browser and asserts it against a pixel baseline
 * (tolerance: 0). This is the same proof style init-baseline/init-guidance/
 * release-toggle scenarios use, extracted so new suites stop copy-pasting it.
 * Baseline regeneration (TASK_E2E_UPDATE_BASELINES) is handled by
 * helpers/pageVisual.js: assert first, write the actual only on failure.
 */
const { assertPageVisualMatch } = require('./pageVisual')

function escapeHtml (text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

async function renderTextInBrowser (I, text, { columns = 1 } = {}) {
  // columns: lay the <pre> out in CSS columns so long listings fit the
  // 1024x768 viewport — a full-page screenshot only captures the viewport,
  // and a proof that scrolls below the fold proves nothing.
  const columnStyle = columns > 1 ? `column-count:${columns};column-gap:32px;` : ''
  await I.usePlaywrightTo('render text in browser', async ({ page }) => {
    await page.setContent(
      '<!DOCTYPE html><html><body style="background:#1e1e1e;margin:0;padding:16px">' +
      `<pre id="task-output" style="color:#d4d4d4;font-family:monospace;font-size:14px;line-height:1.4;white-space:pre-wrap;word-break:break-all;${columnStyle}">` +
      escapeHtml(text) +
      '</pre></body></html>'
    )
  })
  await I.wait(0.5)
}

async function assertTextVisualMatch (I, baselineName, text, renderOptions = {}) {
  await renderTextInBrowser(I, text, renderOptions)
  await assertPageVisualMatch(I, baselineName)
}

module.exports = {
  renderTextInBrowser,
  assertTextVisualMatch
}
