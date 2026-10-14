/**
 * A command's real output as a BIG terminal card, for commands that run in the
 * test runner itself, where no ttyd terminal exists (git hooks, secret scans).
 *
 * The bytes are the ones the command printed. They are replayed the way a
 * terminal shows them: a carriage return redraws a line in place (uv's spinner,
 * filter-branch's progress), an erase-line clears it, colour codes stay colour.
 * The card is a wide dark frame, 1440 px by default, so the storyboard gives it
 * a full row and reads it at its real size, and a long line never wraps in the
 * middle of a word. Several columns sit side by side: two projects answering
 * the same command read as one comparison.
 */
const { addStoryboardFrame, captureElementFrame } = require('../../../../../.config/codeceptjs/storyboard')
const { ansiToHtml } = require('./textRender')

const ESC = String.fromCharCode(27)
const SGR = new RegExp(`(${ESC}\\[[0-9;]*m)`)
// Cursor moves, erases and terminal titles: they place text, they are not text.
const NOT_SGR = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-ln-z]|${ESC}\\][^\\x07]*\\x07`, 'g')
const ERASE_LINE = `${ESC}[2K`
const visible = (text) => text.split(SGR).filter((_, i) => i % 2 === 0).join('')

// One output line as the terminal leaves it on screen.
function screenLine (line) {
  let shown = ''
  line.split('\r').forEach((part, i) => {
    const erased = part.lastIndexOf(ERASE_LINE)
    if (erased !== -1) {
      shown = part.slice(erased + ERASE_LINE.length)
    } else if (i === 0) {
      shown = part
    } else if (part) {
      // A shorter redraw leaves the end of the previous one visible.
      const over = visible(part).length
      shown = over >= visible(shown).length ? part : part + visible(shown).slice(over)
    }
  })
  return shown.replace(NOT_SGR, '')
}

function screenText (raw) {
  return String(raw).split('\n').map(screenLine).join('\n').replace(/\s+$/, '')
}

// Text masks applied between colour codes, so every span keeps its colour.
function maskText (text, masks) {
  return text.split(SGR).map((part, i) => i % 2
    ? part
    : masks.reduce((out, [re, to]) => out.replace(re, to), part)).join('')
}

const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Render `columns` as one dark terminal frame `width` px wide, capture it and
 * assert it against its baseline. A column is the output text, or
 * { title, text } when several sit side by side: the title names whose
 * terminal it is, like a terminal tab.
 */
async function terminalOutputFrame (I, frameName, columns, { width = 1440 } = {}) {
  const cols = [].concat(columns).map(c => typeof c === 'string' ? { text: c } : c)
  const before = await I.usePlaywrightTo('read the window size', async ({ page }) => page.viewportSize())
  await I.resizeWindow(width, 768)
  try {
    const height = await I.usePlaywrightTo('render the terminal output', async ({ page }) => {
      const font = 'margin:0;font-family:monospace;font-size:14px;line-height:17px'
      const pre = `${font};color:#d4d4d4;white-space:pre-wrap;overflow-wrap:anywhere`
      const tab = `${font};color:#9a9a9a;padding-bottom:6px;margin-bottom:10px;border-bottom:1px solid #3c3c3c`
      await page.setContent(
        '<!DOCTYPE html><html><body style="background:#1e1e1e;margin:0">' +
        `<div id="terminal-output" style="box-sizing:border-box;width:${width}px;padding:16px 22px;display:flex;gap:28px;background:#1e1e1e">` +
        cols.map(c => '<div style="flex:1 1 0;min-width:0">' +
          (c.title ? `<div style="${tab}">${escapeHtml(c.title)}</div>` : '') +
          `<pre style="${pre}">${ansiToHtml(c.text)}</pre></div>`).join('') +
        '</div></body></html>'
      )
      await page.evaluate(() => document.fonts.ready)
      return page.evaluate(() => Math.ceil(document.getElementById('terminal-output').getBoundingClientRect().height))
    })
    // An element is shot whole only when it fits the window.
    await I.resizeWindow(width, Math.max(768, height + 32))
    await addStoryboardFrame(I, await captureElementFrame(I, frameName, '#terminal-output'))
  } finally {
    if (before) await I.resizeWindow(before.width, before.height)
  }
}

module.exports = { screenText, maskText, terminalOutputFrame }
