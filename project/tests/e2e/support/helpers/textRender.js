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

// VS Code integrated-terminal palette — matches the #1e1e1e background so the
// converted ANSI looks like a real terminal, not invented colours.
const ANSI_FG = {
  30: '#000000',
  31: '#cd3131',
  32: '#0dbc79',
  33: '#e5e510',
  34: '#2472c8',
  35: '#bc3fbc',
  36: '#11a8cd',
  37: '#e5e5e5',
  90: '#666666',
  91: '#f14c4c',
  92: '#23d18b',
  93: '#f5f543',
  94: '#3b8eea',
  95: '#d670d6',
  96: '#29b8db',
  97: '#ffffff'
}

// Convert the REAL ANSI SGR codes a command emits (renovate/go-task colours, git
// diff red/green) into coloured HTML spans. Plain text (no ANSI) is just escaped, so
// existing monochrome baselines render byte-identically. Only the SGR subset actually
// emitted is handled (reset, bold, default-fg, the 8 + 8 foreground colours).
function ansiToHtml (input) {
  const ESC = String.fromCharCode(27)
  const sgr = new RegExp(ESC + '\\[([0-9;]*)m', 'g')
  const style = { color: null, bold: false }
  let result = ''
  let cursor = 0
  let match
  const emit = (txt) => {
    if (!txt) return
    const css = []
    if (style.color) css.push('color:' + style.color)
    if (style.bold) css.push('font-weight:bold')
    result += css.length ? `<span style="${css.join(';')}">${escapeHtml(txt)}</span>` : escapeHtml(txt)
  }
  while ((match = sgr.exec(String(input))) !== null) {
    emit(String(input).slice(cursor, match.index))
    const codes = match[1] === '' ? [0] : match[1].split(';').map(Number)
    for (const code of codes) {
      if (code === 0) { style.color = null; style.bold = false } else if (code === 1) { style.bold = true } else if (code === 22) { style.bold = false } else if (code === 39) { style.color = null } else if (ANSI_FG[code]) { style.color = ANSI_FG[code] }
    }
    cursor = sgr.lastIndex
  }
  emit(String(input).slice(cursor))
  return result
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
      ansiToHtml(text) +
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
  ansiToHtml,
  renderTextInBrowser,
  assertTextVisualMatch
}
