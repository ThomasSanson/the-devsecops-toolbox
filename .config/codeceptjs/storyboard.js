/**
 * Storyboard — ONE SVG per scenario, built from the real frames captured
 * during the journey.
 *
 * Why SVG and not PNG: every piece of text drawn AROUND the frames (the
 * feature title, the re-run command, the file path, the per-panel captions
 * and reproduce commands) is real selectable text — a reader can copy/paste
 * the command that replays the scenario, which a PNG can never offer. The
 * frames themselves stay bitmap (embedded as data URIs): they are genuine
 * captures and each one is ALSO asserted pixel-perfect against its own
 * baseline (per sentence, per image) — the SVG is the human artifact, the
 * per-frame PNGs are the regression gate.
 *
 * Two faces, one module:
 *   1. CodeceptJS plugin (the default export): listens to test lifecycle
 *      events and fills the storyboard header automatically from the Gherkin
 *      metadata — feature title, scenario title, feature file, scenario tag
 *      (the LAST tag is the scenario's unique re-run tag by repo convention).
 *      Registered in codecept.conf.js; zero configuration.
 *   2. Panel API (named exports): step files open one numbered panel per
 *      Gherkin line (`panel(title)`), attach the frames captured during that
 *      step (`frame(png)`) and optionally annotate it (`note`, `copy`).
 *      `render(outFile)` writes the final SVG.
 */

const fs = require('fs')
const path = require('path')

let board = null

function stripTags (title) {
  return String(title || '').replace(/\s*@[\w:-]+/g, '').trim()
}

// Fill the header from a scenario about to run. Exposed for the plugin AND
// for direct calls (standalone rendering, tests).
function begin (meta) {
  board = {
    feature: meta.feature || '',
    scenario: meta.scenario || '',
    file: meta.file || '',
    rerun: meta.rerun || '',
    baseDir: meta.baseDir || '',
    panels: []
  }
}

// Where this scenario's frames live, relative to _output/ and to
// screenshots/base/ — derived by the plugin from the feature file path
// (features/<dir>/<name>.feature -> <dir>/<name>), so the baseline layout
// always mirrors the feature tree with zero configuration.
function baseDir () {
  if (!board || !board.baseDir) throw new Error('storyboard.baseDir() called before the plugin saw the scenario')
  return board.baseDir
}

function panel (title, opts = {}) {
  if (!board) begin({})
  board.panels.push({ title, note: opts.note || '', copy: opts.copy || '', images: [] })
}

// A panel's FIRST frame inherits the panel's note/copy; extra frames of the
// same panel carry their own (or none) — each frame is one card in the grid.
function frame (pngPath, opts = {}) {
  const current = board && board.panels[board.panels.length - 1]
  if (!current) throw new Error('storyboard.frame() called with no open panel')
  current.images.push({ file: pngPath, note: opts.note, copy: opts.copy })
}

// Merge late annotations (e.g. a URL only known mid-step) into the open panel.
function annotate (opts = {}) {
  const current = board && board.panels[board.panels.length - 1]
  if (!current) throw new Error('storyboard.annotate() called with no open panel')
  if (opts.note) current.note = opts.note
  if (opts.copy) current.copy = opts.copy
}

function panels () {
  return board ? board.panels : []
}

// ---------------------------------------------------------------------------
// SVG rendering — pure Node, no dependencies.
// ---------------------------------------------------------------------------

// PNG dimensions live in the header chunk: width/height big-endian at bytes 16/20.
function pngSize (file) {
  const buf = Buffer.alloc(24)
  const fd = fs.openSync(file, 'r')
  fs.readSync(fd, buf, 0, 24, 0)
  fs.closeSync(fd)
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

function esc (text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// SVG has no text auto-wrap: break on words against an estimated glyph width.
function wrap (text, maxWidth, charWidth) {
  const perLine = Math.max(8, Math.floor(maxWidth / charWidth))
  const lines = []
  let line = ''
  for (const word of String(text).split(/\s+/)) {
    const candidate = line ? line + ' ' + word : word
    if (candidate.length > perLine && line) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines
}

const THEME = {
  bg: '#0f1017',
  card: '#181a24',
  slot: '#0b0c12',
  text: '#e8e8ec',
  dim: '#98a0b3',
  accent: '#7aa2f7',
  badge: '#3b82f6',
  codeBg: '#1c1e2a',
  sans: 'ui-sans-serif, system-ui, sans-serif',
  mono: "ui-monospace, 'JetBrains Mono', 'Fira Code', monospace"
}

// Two-column grid of uniform cards, one card per frame: the image sits
// full-width at the top of the card in a fixed-height slot (scaled to fit,
// letterboxed on the slot colour), the texts below. 700x438 keeps the
// 1024x640 GitLab pages at their exact aspect ratio.
const GRID = {
  cols: 2,
  cardW: 700,
  imgH: 438,
  pagePad: 32,
  gap: 24,
  textPad: 18
}

/**
 * Write the storyboard SVG. options.imageDir substitutes every frame with the
 * same-named PNG inside that directory — used to build the COMMITTED SVG from
 * the reviewed baselines instead of the run's actuals.
 */
function render (outFile, options = {}) {
  if (!board || !board.panels.length) {
    throw new Error('storyboard.render() called with no panels')
  }
  const t = THEME
  const g = GRID
  const resolveImage = (file) =>
    options.imageDir ? path.join(options.imageDir, path.basename(file)) : file

  // One card per frame; a multi-frame panel repeats its number and title so
  // every card still reads as its Gherkin line.
  const cards = board.panels.flatMap((p, pi) =>
    p.images.map((img, fi) => ({
      n: pi + 1,
      title: p.title,
      note: img.note !== undefined ? img.note : (fi === 0 ? p.note : ''),
      copy: img.copy !== undefined ? img.copy : (fi === 0 ? p.copy : ''),
      file: resolveImage(img.file)
    }))
  )

  const width = 2 * g.pagePad + g.cols * g.cardW + (g.cols - 1) * g.gap
  const textW = g.cardW - 2 * g.textPad
  const parts = []

  const text = (str, x, yy, { size = 14, fill = t.text, font = t.sans, weight = 'normal', anchor = 'start' } = {}) => {
    parts.push(
      `<text x="${x}" y="${yy}" font-family="${font}" font-size="${size}" fill="${fill}"` +
      (weight !== 'normal' ? ` font-weight="${weight}"` : '') +
      (anchor !== 'start' ? ` text-anchor="${anchor}"` : '') +
      `>${esc(str)}</text>`
    )
  }

  // Uniform card height: the tallest text block sets it for every card.
  const layoutOf = (card) => {
    const title = wrap(`${card.n}. ${card.title}`, textW, 8.2)
    const note = card.note ? wrap(card.note, textW, 6.6) : []
    const copy = card.copy ? wrap(card.copy, textW, 7.6) : []
    return { title, note, copy, h: 16 + title.length * 21 + note.length * 18 + (copy.length ? 6 + copy.length * 18 : 0) + 16 }
  }
  const textH = Math.max(...cards.map(c => layoutOf(c).h))
  const cardH = g.imgH + textH
  const rows = Math.ceil(cards.length / g.cols)

  // --- Header: feature left, scenario under it, file top-right, rerun bar ---
  text(board.feature, g.pagePad, 54, { size: 28, weight: '700' })
  text('Scenario: ' + board.scenario, g.pagePad, 82, { size: 15, fill: t.dim })
  if (board.file) {
    text(board.file, width - g.pagePad, 44, { size: 12, fill: t.dim, font: t.mono, anchor: 'end' })
    text('e2e storyboard · baseline', width - g.pagePad, 62, { size: 12, fill: t.dim, anchor: 'end' })
  }
  let y = 104
  if (board.rerun) {
    parts.push(`<rect x="${g.pagePad}" y="${y}" width="${width - 2 * g.pagePad}" height="36" rx="8" fill="${t.codeBg}"/>`)
    text('replay this scenario', g.pagePad + 16, y + 23, { size: 12.5, fill: t.dim })
    text(board.rerun, g.pagePad + 170, y + 23, { size: 13, fill: t.accent, font: t.mono })
    y += 36
  }
  y += 28

  // --- Cards ---
  cards.forEach((card, i) => {
    const cx = g.pagePad + (i % g.cols) * (g.cardW + g.gap)
    const cy = y + Math.floor(i / g.cols) * (cardH + g.gap)
    const { w, h } = pngSize(card.file)
    const data = fs.readFileSync(card.file).toString('base64')
    const scale = Math.min(g.cardW / w, g.imgH / h)
    const dw = w * scale
    const dh = h * scale

    parts.push(`<clipPath id="card${i}"><rect x="${cx}" y="${cy}" width="${g.cardW}" height="${cardH}" rx="12"/></clipPath>`)
    parts.push(`<rect x="${cx}" y="${cy}" width="${g.cardW}" height="${cardH}" rx="12" fill="${t.card}"/>`)
    parts.push(`<g clip-path="url(#card${i})">`)
    parts.push(`<rect x="${cx}" y="${cy}" width="${g.cardW}" height="${g.imgH}" fill="${t.slot}"/>`)
    parts.push(
      `<image x="${(cx + (g.cardW - dw) / 2).toFixed(1)}" y="${(cy + (g.imgH - dh) / 2).toFixed(1)}"` +
      ` width="${dw.toFixed(1)}" height="${dh.toFixed(1)}" href="data:image/png;base64,${data}"/>`
    )
    parts.push('</g>')

    // Number badge on the card chrome, never inside the captured pixels.
    parts.push(`<circle cx="${cx + 30}" cy="${cy + 30}" r="16" fill="${t.badge}"/>`)
    text(String(card.n), cx + 30, cy + 35, { size: 15, fill: '#ffffff', weight: '700', anchor: 'middle' })

    const layout = layoutOf(card)
    let ty = cy + g.imgH + 16 + 15
    for (const line of layout.title) {
      text(line, cx + g.textPad, ty, { size: 15.5, weight: '600' })
      ty += 21
    }
    for (const line of layout.note) {
      text(line, cx + g.textPad, ty, { size: 12.8, fill: t.dim })
      ty += 18
    }
    ty += 6
    for (const line of layout.copy) {
      text(line, cx + g.textPad, ty, { size: 12.5, fill: t.accent, font: t.mono })
      ty += 18
    }
  })

  y += rows * (cardH + g.gap) - g.gap
  y += 30
  text(
    `Storyboard e2e · ${board.panels.length} steps · ${cards.length} frames · every frame is its own pixel baseline (tolerance: 0)`,
    g.pagePad, y, { size: 12, fill: t.dim }
  )

  const height = y + g.pagePad
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n` +
    `<rect width="${width}" height="${height}" fill="${t.bg}"/>\n` +
    parts.join('\n') +
    '\n</svg>\n'

  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, svg)
  return outFile
}

// ---------------------------------------------------------------------------
// CodeceptJS plugin — fills the header from the Gherkin metadata of every
// scenario before it runs (and drops stale panels from a previous test),
// then renders the SVG when the test ends: to _output on every outcome (a
// failing run's partial board shows exactly how far the journey got), and —
// only on a PASSED run in baseline-update mode — the committed copy next to
// the frame baselines, rebuilt FROM those reviewed baselines so it never
// embeds unreviewed pixels.
// codeceptjs 3.7.8 sets test.title / test.tags / test.file / test.parent.title
// (feature name) in lib/mocha/gherkin.js; titles carry the tags appended.
// ---------------------------------------------------------------------------
module.exports = function storyboardPlugin () {
  const { event } = require('codeceptjs')
  event.dispatcher.on(event.test.before, (test) => {
    const tags = test.tags || []
    const tag = tags.length ? tags[tags.length - 1] : ''
    let file = ''
    let base = ''
    if (test.file && global.codecept_dir) {
      // Repo-relative display path, independent of where the suite is mounted.
      file = path.join('project/tests/e2e', path.relative(global.codecept_dir, test.file))
      const fromFeatures = path.relative(path.join(global.codecept_dir, 'features'), test.file)
      if (!fromFeatures.startsWith('..')) base = fromFeatures.replace(/\.feature$/, '')
    }
    begin({
      feature: stripTags(test.parent && test.parent.title),
      scenario: stripTags(test.title),
      file,
      baseDir: base,
      rerun: tag ? `task test -- --grep "${tag}"` : ''
    })
  })

  const finish = (passed) => {
    if (!board || !board.panels.length || !board.baseDir || !global.codecept_dir) return
    try {
      render(path.join(global.codecept_dir, '_output', `${board.baseDir}.svg`))
      if (passed && process.env.TASK_E2E_UPDATE_BASELINES) {
        const baseRoot = path.join(global.codecept_dir, 'screenshots', 'base')
        render(path.join(baseRoot, `${board.baseDir}.svg`), {
          imageDir: path.join(baseRoot, board.baseDir)
        })
      }
    } catch (err) {
      // Rendering must never mask the test outcome.
      console.error(`storyboard: SVG rendering failed: ${err.message}`)
    }
  }
  event.dispatcher.on(event.test.passed, () => finish(true))
  event.dispatcher.on(event.test.failed, () => finish(false))
}

module.exports.begin = begin
module.exports.baseDir = baseDir
module.exports.panel = panel
module.exports.frame = frame
module.exports.annotate = annotate
module.exports.panels = panels
module.exports.render = render
