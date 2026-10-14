/**
 * The <pre> renderer for captured command output: a dark block, hugging its
 * text, captured as a storyboard frame and asserted pixel-perfect inside the
 * step. stripAnsi turns captured output back into plain text for the asserts.
 */
const {
  addStoryboardFrame,
  captureElementFrame
} = require('../../../../../.config/codeceptjs/storyboard')
const { ansiToHtml } = require('./textRender')

function stripAnsi (str) {
  return String(str)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07]*\x07/g, '')
}

function escapeHtml (text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Render deterministic text to a dark <pre> and capture it as a storyboard
// frame (asserted pixel-perfect against its own baseline inside the step).
//
// `colour: true` keeps the REAL terminal colours a command emitted (ansiToHtml
// turns its ANSI codes into spans). It is OPT-IN, and deliberately so: several
// callers hand over text that still carries ANSI, which the plain escape has
// always rendered as visible escape sequences. Converting it silently made
// those frames NARROWER and broke their baselines in CI — a shared renderer
// changes every story that uses it, so a new behaviour has to be asked for.
async function renderPreFrame (I, frameName, text, opts = {}) {
  const { height = 640, colour = false } = typeof opts === 'number' ? { height: opts } : opts
  I.resizeWindow(1024, height)
  await I.usePlaywrightTo('render captured output in browser', async ({ page }) => {
    await page.setContent(
      '<!DOCTYPE html><html><body style="background:#1e1e1e;margin:0">' +
      // The box hugs its content: the element-cropped frame is exactly the
      // verdict text plus padding — a 3-line verdict yields a small frame,
      // never a mostly-empty viewport.
      '<div id="task-output-box" style="display:inline-block;background:#1e1e1e;padding:16px 22px 16px 16px;max-width:992px">' +
      '<pre id="task-output" style="margin:0;color:#d4d4d4;font-family:monospace;font-size:14px;line-height:1.4;white-space:pre-wrap;word-break:break-all">' +
      (colour ? ansiToHtml(text) : escapeHtml(text)) +
      '</pre></div></body></html>'
    )
  })
  await I.wait(0.5)
  await addStoryboardFrame(I, await captureElementFrame(I, frameName, '#task-output-box'))
  I.resizeWindow(1024, 768)
}

module.exports = {
  stripAnsi,
  renderPreFrame
}
