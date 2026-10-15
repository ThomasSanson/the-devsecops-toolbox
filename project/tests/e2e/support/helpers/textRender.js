/**
 * The colour codes a command printed, turned into coloured HTML spans, for the
 * stories that show captured output in the browser (terminalRender.js,
 * renovate-runtime.js). Plain text is only escaped.
 */
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

module.exports = {
  ansiToHtml
}
