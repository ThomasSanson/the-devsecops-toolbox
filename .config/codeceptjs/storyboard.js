/**
 * Storyboard — ONE SVG per scenario, built from the real frames captured
 * during the journey. ONE Gherkin sentence = ONE card = ONE pixel baseline.
 *
 * Why SVG and not PNG: every piece of text drawn AROUND the frames (the
 * feature title, the re-run command, the file path, the per-card captions
 * and reproduce commands) is real selectable text — a reader can copy/paste
 * the command that replays the scenario, which a PNG can never offer. The
 * frames themselves stay bitmap (embedded as data URIs): they are genuine
 * captures and each one is ALSO asserted pixel-perfect against its own
 * baseline, inside the step that captured it — the SVG is the human
 * artifact, the per-frame PNGs are the regression gate. Open the SVG
 * locally in a browser: one click selects a whole command (Chromium/Safari;
 * inert in Firefox and in GitLab's image-based preview).
 *
 * This module is SELF-CONTAINED so any project generated from the template
 * can use it as shipped: register the plugin in codecept.conf.js, then in a
 * step file
 *
 *   const storyboard = require('../../../.config/codeceptjs/storyboard')
 *   storyboard.storyboardStep(Given, 'a sentence', { note, copy }, async () => {
 *     ...drive the app...
 *     await storyboard.addStoryboardFrame(I, await storyboard.capturePageFrame(I, 'frame-name'))
 *   })
 *
 * Every path is derived from global.codecept_dir (the codecept.conf.js
 * directory): frames land in _output/storyboard-frames/, per-frame baselines
 * in screenshots/base/<feature-dir>/<scenario>/, the committed SVG in
 * storyboards/<feature-dir>/<scenario>.svg — all mirrored from the feature
 * file path, zero configuration.
 */

const fs = require('fs')
const path = require('path')

let board = null

function stripTags (title) {
  return String(title || '').replace(/\s*@[\w:-]+/g, '').trim()
}

function e2eDir () {
  if (!global.codecept_dir) throw new Error('storyboard: global.codecept_dir is not set — run under codeceptjs')
  return global.codecept_dir
}

// Every line of the scenario, verbatim from the .feature source, so each
// card can carry its exact keyword (Given/When/Then/And/But — the And/But
// resolution the step registry cannot provide).
// ponytail: single flat Scenario only — no Background/Examples resolution;
// extend when a storyboard scenario first uses them.
function parseScenarioLines (featureFile, scenarioTitle) {
  let source
  try {
    source = fs.readFileSync(featureFile, 'utf8')
  } catch (_) {
    return []
  }
  const lines = source.split('\n').map(line => line.trim())
  const start = lines.findIndex(line =>
    /^Scenario( Outline)?:/.test(line) && line.replace(/^Scenario( Outline)?:\s*/, '') === scenarioTitle
  )
  if (start === -1) return []
  const out = []
  let group = null
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line === '' || line.startsWith('#') || line.startsWith('@')) continue
    if (/^(Scenario|Feature|Examples|Background)/.test(line)) break
    const step = line.match(/^(Given|When|Then|And|But)\s+(.*)$/)
    if (!step) continue
    if (step[1] === 'Given' || step[1] === 'When' || step[1] === 'Then') group = step[1].toLowerCase()
    out.push({ keyword: step[1], group, text: step[2] })
  }
  return out
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
    lines: meta.featureFile ? parseScenarioLines(meta.featureFile, meta.scenario || '') : (meta.lines || []),
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
// Step-side API — register a sentence as a card, capture and assert frames.
// ---------------------------------------------------------------------------

// Register a Gherkin step through its Given/When/Then function AND open the
// card whose title IS the step's own pattern: the same string declares the
// scenario line and captions the image, so the feature and the storyboard
// can never drift apart.
function storyboardStep (register, pattern, opts, fn) {
  register(pattern, async (...args) => {
    panel(pattern, opts)
    await fn(...args)
  })
}

function frameOutputPath (frameName) {
  return path.join(e2eDir(), '_output', 'storyboard-frames', frameName + '.png')
}

// Full-page snapshot of the CURRENT page (mask its volatile content first)
// into the frames dir; returns the PNG's absolute path.
async function capturePageFrame (I, frameName) {
  fs.mkdirSync(path.dirname(frameOutputPath(frameName)), { recursive: true })
  await I.takeScreenshot(`storyboard-frames/${frameName}`)
  return frameOutputPath(frameName)
}

/**
 * Assert `_output/<baselineName>.png` against its committed baseline, or — in
 * baseline-update mode (TASK_E2E_UPDATE_BASELINES=1) — assert first and only
 * when the assert FAILS persist the freshly captured actual as the baseline:
 * green baselines stay byte-identical, so a regeneration run produces no
 * churn. Each baseline produced this way MUST be inspected by a human, which
 * is why the mode is refused in CI — there it would silently swallow every
 * visual regression.
 */
async function assertOrUpdateBaseline (I, baselineName) {
  if (process.env.TASK_E2E_UPDATE_BASELINES && process.env.CI) {
    throw new Error('TASK_E2E_UPDATE_BASELINES is forbidden in CI — baselines must be regenerated and inspected locally')
  }
  if (process.env.TASK_E2E_UPDATE_BASELINES) {
    // tryTo: the recorder marks the test failed on a plain try/catch around
    // an actor call; the global tryTo (enabled plugin) is the supported way
    // to probe an assert.
    // eslint-disable-next-line no-undef
    const matches = await tryTo(() => I.assertVisualMatch(baselineName, { captureActual: false }))
    if (!matches) {
      const actualPath = path.join(e2eDir(), '_output', baselineName + '.png')
      const baselinePath = path.join(e2eDir(), 'screenshots', 'base', baselineName + '.png')
      fs.mkdirSync(path.dirname(baselinePath), { recursive: true })
      fs.copyFileSync(actualPath, baselinePath)
    }
    return
  }
  await I.assertVisualMatch(baselineName, { captureActual: false })
}

// Attach the frame to the current card and assert it against its own
// baseline immediately (tolerance: 0, update-mode aware): a visual
// regression fails on the exact sentence whose image drifted.
async function addStoryboardFrame (I, png) {
  frame(png)
  const name = `${baseDir()}/${path.basename(png, '.png')}`
  const actualPath = path.join(e2eDir(), '_output', `${name}.png`)
  fs.mkdirSync(path.dirname(actualPath), { recursive: true })
  fs.copyFileSync(png, actualPath)
  await assertOrUpdateBaseline(I, name)
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
  given: '#9ece6a',
  when: '#7aa2f7',
  then: '#bb9af7',
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

  // Verbatim Gherkin keyword of a sentence (And/But included), coloured by
  // its resolved group so the grid scans as stage / actions / proofs.
  const lineOf = (title) => (board.lines || []).find(l => l.text === title)
  const keywordColor = { given: t.given, when: t.when, then: t.then }

  const width = 2 * g.pagePad + g.cols * g.cardW + (g.cols - 1) * g.gap
  const textW = g.cardW - 2 * g.textPad
  const parts = []

  const text = (str, x, yy, { size = 14, fill = t.text, font = t.sans, weight = 'normal', anchor = 'start', cls = '' } = {}) => {
    parts.push(
      `<text x="${x}" y="${yy}" font-family="${font}" font-size="${size}" fill="${fill}"` +
      (weight !== 'normal' ? ` font-weight="${weight}"` : '') +
      (anchor !== 'start' ? ` text-anchor="${anchor}"` : '') +
      (cls ? ` class="${cls}"` : '') +
      `>${esc(str)}</text>`
    )
  }

  // A copyable command: ONE <text class="copy"> so a single click selects the
  // WHOLE command (user-select:all — Chromium/Safari; inert elsewhere). Each
  // wrapped line is a <tspan>; tspans concatenate with NO separator on copy,
  // so every line but the last keeps a trailing space (xml:space preserves it).
  const copyText = (str, x, yy, { size = 12.5, fill = t.accent } = {}) => {
    const lines = wrap(str, textW, 7.6)
    const tspans = lines.map((line, i) =>
      `<tspan x="${x}" dy="${i === 0 ? 0 : 18}">${esc(line + (i < lines.length - 1 ? ' ' : ''))}</tspan>`
    ).join('')
    parts.push(
      `<text x="${x}" y="${yy}" font-family="${t.mono}" font-size="${size}" fill="${fill}"` +
      ` class="copy" xml:space="preserve">${tspans}</text>`
    )
    return lines.length
  }

  // Uniform card height: the tallest text block sets it for every card.
  const layoutOf = (card) => {
    const line = lineOf(card.title)
    const keyword = line ? line.keyword : ''
    const title = wrap(`${keyword ? keyword + ' ' : ''}${card.title}`, textW, 8.2)
    const note = card.note ? wrap(card.note, textW, 6.6) : []
    const copy = card.copy ? wrap(card.copy, textW, 7.6) : []
    return { keyword, group: line ? line.group : '', title, note, copy, h: 16 + title.length * 21 + note.length * 18 + (copy.length ? 6 + copy.length * 18 : 0) + 16 }
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
    copyText(board.rerun, g.pagePad + 170, y + 23, { size: 13 })
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
    // The native <title> tooltip names the frame's baseline PNG: hover a
    // card, know exactly which baseline to inspect or regenerate.
    parts.push(
      `<image x="${(cx + (g.cardW - dw) / 2).toFixed(1)}" y="${(cy + (g.imgH - dh) / 2).toFixed(1)}"` +
      ` width="${dw.toFixed(1)}" height="${dh.toFixed(1)}" href="data:image/png;base64,${data}">` +
      `<title>${esc(path.basename(card.file))}</title></image>`
    )
    parts.push('</g>')

    // Number badge on the card chrome, never inside the captured pixels.
    parts.push(`<circle cx="${cx + 30}" cy="${cy + 30}" r="16" fill="${t.badge}"/>`)
    text(String(card.n), cx + 30, cy + 35, { size: 15, fill: '#ffffff', weight: '700', anchor: 'middle' })

    const layout = layoutOf(card)
    let ty = cy + g.imgH + 16 + 15
    layout.title.forEach((line, li) => {
      if (li === 0 && layout.keyword && line.startsWith(layout.keyword)) {
        // Verbatim keyword coloured by its group — the only chrome that also
        // survives GitLab's image-based preview.
        const rest = line.slice(layout.keyword.length)
        parts.push(
          `<text x="${cx + g.textPad}" y="${ty}" font-family="${t.sans}" font-size="15.5" font-weight="600"` +
          ` fill="${t.text}" xml:space="preserve"><tspan fill="${keywordColor[layout.group] || t.dim}">${esc(layout.keyword)}</tspan>${esc(rest)}</text>`
        )
      } else {
        text(line, cx + g.textPad, ty, { size: 15.5, weight: '600' })
      }
      ty += 21
    })
    for (const line of layout.note) {
      text(line, cx + g.textPad, ty, { size: 12.8, fill: t.dim })
      ty += 18
    }
    if (layout.copy.length) {
      ty += 6
      copyText(card.copy, cx + g.textPad, ty)
      ty += layout.copy.length * 18
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
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"` +
    ' role="img" aria-labelledby="sb-title sb-desc">\n' +
    `<title id="sb-title">${esc(board.feature)} — ${esc(board.scenario)}</title>\n` +
    `<desc id="sb-desc">e2e storyboard · ${esc(board.file)} · replay: ${esc(board.rerun)}</desc>\n` +
    '<style>.copy{user-select:all;-webkit-user-select:all;cursor:text}.copy:hover{text-decoration:underline}</style>\n' +
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
// only on a PASSED run in baseline-update mode — the committed copy under
// storyboards/, rebuilt FROM the reviewed baselines so it never embeds
// unreviewed pixels.
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
      // Display path relative to the process cwd (the repo root in the
      // container), correct wherever the suite lives in a given project.
      file = path.relative(process.cwd(), test.file)
      const fromFeatures = path.relative(path.join(global.codecept_dir, 'features'), test.file)
      if (!fromFeatures.startsWith('..')) base = fromFeatures.replace(/\.feature$/, '')
    }
    begin({
      feature: stripTags(test.parent && test.parent.title),
      scenario: stripTags(test.title),
      file,
      featureFile: test.file,
      baseDir: base,
      rerun: tag ? `task test -- --grep "${tag}"` : ''
    })
  })

  const finish = (passed) => {
    if (!board || !board.panels.length || !board.baseDir || !global.codecept_dir) return
    try {
      render(path.join(global.codecept_dir, '_output', `${board.baseDir}.svg`))
      if (passed && process.env.TASK_E2E_UPDATE_BASELINES) {
        render(path.join(global.codecept_dir, 'storyboards', `${board.baseDir}.svg`), {
          imageDir: path.join(global.codecept_dir, 'screenshots', 'base', board.baseDir)
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
module.exports.parseScenarioLines = parseScenarioLines
module.exports.panel = panel
module.exports.frame = frame
module.exports.annotate = annotate
module.exports.panels = panels
module.exports.storyboardStep = storyboardStep
module.exports.capturePageFrame = capturePageFrame
module.exports.frameOutputPath = frameOutputPath
module.exports.assertOrUpdateBaseline = assertOrUpdateBaseline
module.exports.addStoryboardFrame = addStoryboardFrame
module.exports.render = render
