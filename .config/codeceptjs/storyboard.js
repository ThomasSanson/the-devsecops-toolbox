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
 * can use it as shipped: register the plugin in codecept.conf.js and the
 * .feature file becomes the single human-authored source — the sentences,
 * plus structured comments attached to the sentence below them:
 *
 *   # Chapter: a full-width band opens here
 *   # Note: why this step matters, what to look at
 *   # Copy: exact command shown one-click-copyable under the card
 *   When the developer starts the installer
 *
 * Cards open automatically for every Gherkin sentence (bddStep.before). The
 * step file only drives the app and captures the proof:
 *
 *   const storyboard = require('../../../.config/codeceptjs/storyboard')
 *   storyboard.storyboardStep(When, 'the developer starts the installer', async () => {
 *     ...drive the app...
 *     await storyboard.addStoryboardFrame(I, await storyboard.capturePageFrame(I, 'frame-name'))
 *   })
 *
 * (storyboardStep = plain Given/When/Then registration + escaping of
 * cucumber-expression metacharacters, so "CI/CD" or "(y/N)" in a sentence
 * never breaks the match. Runtime-only annotations — e.g. a URL known only
 * mid-step — still go through storyboard.annotate({ note, copy }).)
 *
 * Every path is derived from global.codecept_dir (the codecept.conf.js
 * directory): frames land in _output/storyboard-frames/, per-frame baselines
 * in screenshots/base/<feature-dir>/<scenario>/, the committed SVG in
 * storyboards/<feature-dir>/<scenario>.svg — all mirrored from the feature
 * file path, zero configuration.
 */

const fs = require('fs')
const path = require('path')
const { tryTo } = require('codeceptjs/effects')

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
  let chapter = null
  let note = null
  let copy = null
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('#')) {
      // Structured comments make the .feature the single human-authored
      // source: they all attach to the NEXT sentence.
      //   # Chapter: Title  -> full-width chapter band before that card
      //   # Note: text      -> the card's explanation (why this step, what to see)
      //   # Copy: command   -> the card's one-click-copyable command
      const mark = line.match(/^#\s*(Chapter|Note|Copy)\s*:\s*(.+)$/i)
      if (mark) {
        const kind = mark[1].toLowerCase()
        if (kind === 'chapter') chapter = mark[2].trim()
        // Several `# Note:` lines stack into paragraphs: a long explanation
        // reads as a few short blocks instead of one dense wall of text.
        if (kind === 'note') note = note ? `${note}\n${mark[2].trim()}` : mark[2].trim()
        if (kind === 'copy') copy = mark[2].trim()
      }
      continue
    }
    if (line === '' || line.startsWith('@')) continue
    if (/^(Scenario|Feature|Examples|Background)/.test(line)) break
    const step = line.match(/^(Given|When|Then|And|But)\s+(.*)$/)
    if (!step) continue
    if (step[1] === 'Given' || step[1] === 'When' || step[1] === 'Then') group = step[1].toLowerCase()
    out.push({ keyword: step[1], group, text: step[2], chapter, note, copy })
    chapter = null
    note = null
    copy = null
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

// Storyboard sentences are LITERAL: a cucumber-expression would reinterpret
// "CI/CD" as an alternation and "(...)" as optional text. Escape the
// metacharacters at registration so the .feature line, the registered step
// and the card title stay the exact same verbatim string.
function escapeCucumberExpression (sentence) {
  return sentence.replace(/[\\/(){}]/g, '\\$&')
}

// Register a Gherkin step through its Given/When/Then function. The card
// itself opens AUTOMATICALLY (the plugin listens to bddStep.before), so this
// wrapper only (1) escapes cucumber-expression metacharacters so the .feature
// line and the pattern stay the exact same verbatim string, and (2) applies
// legacy JS note/copy options — new scenarios should prefer `# Note:` /
// `# Copy:` comments in the .feature instead. `opts` is optional.
function storyboardStep (register, pattern, opts, fn) {
  if (typeof opts === 'function') {
    fn = opts
    opts = null
  }
  register(escapeCucumberExpression(pattern), async (...args) => {
    if (opts && (opts.note || opts.copy)) annotate(opts)
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

// Element-cropped snapshot: the frame is EXACTLY the selector's box, never
// the whole viewport — a short verdict yields a short frame, not a mostly
// empty page. Use for rendered <pre> verdicts and any focused element.
async function captureElementFrame (I, frameName, selector) {
  fs.mkdirSync(path.dirname(frameOutputPath(frameName)), { recursive: true })
  await I.captureScreenshot(`storyboard-frames/${frameName}`, 'actual', selector)
  return frameOutputPath(frameName)
}

// Guarantee the capture actually rendered: a frame whose sampled pixels are
// ~one single colour is a blank/unfinished capture (page not loaded, empty
// render) and must fail LOUD at capture time, not survive into a baseline.
// pngjs ships with the visual helper in the runner image; outside it (local
// standalone rendering) the guard degrades to a no-op.
function assertFrameNotEmpty (png) {
  let PNG
  try { PNG = require('pngjs').PNG } catch (_) { return }
  const img = PNG.sync.read(fs.readFileSync(png))
  const { width, height, data } = img
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 20000)))
  const counts = new Map()
  let sampled = 0
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (width * y + x) << 2
      // Quantize to 4 bits per channel so soft gradients still count as one colour.
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4)
      counts.set(key, (counts.get(key) || 0) + 1)
      sampled++
    }
  }
  const dominant = Math.max(...counts.values())
  const ratio = dominant / sampled
  if (ratio > 0.985) {
    throw new Error(
      `storyboard frame "${path.basename(png)}" looks empty — ${(ratio * 100).toFixed(1)}% of its pixels are a single colour. ` +
      'The capture probably fired before the content rendered (or the element crop missed). Fix the capture; do not baseline a blank frame.'
    )
  }
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
    // an actor call; tryTo is the supported way to probe an assert. Since
    // CodeceptJS 4 it is no longer a plugin exposing a global — it is an
    // effect imported from the package, and only this directory can resolve
    // it (node_modules lives here, not in the test tree), which is why the
    // module re-exports it below.
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
// regression fails on the exact sentence whose image drifted, and the error
// message carries everything a human needs to act on it.
async function addStoryboardFrame (I, png) {
  assertFrameNotEmpty(png)
  frame(png)
  const name = `${baseDir()}/${path.basename(png, '.png')}`
  const actualPath = path.join(e2eDir(), '_output', `${name}.png`)
  fs.mkdirSync(path.dirname(actualPath), { recursive: true })
  fs.copyFileSync(png, actualPath)
  try {
    await assertOrUpdateBaseline(I, name)
  } catch (err) {
    // Exact marker of WHICH frame failed its visual assert — the failure band
    // trusts this, never a heuristic (a diff PNG may not even exist, e.g. on
    // an "Image dimensions do not match" error).
    if (board) board.visualFailure = path.basename(png)
    if (err && typeof err.message === 'string') {
      err.message +=
        `\n  storyboard frame   : ${name}.png` +
        `\n  pixel diff         : screenshots/diff/${path.dirname(name)}/Diff_${path.basename(name)}.png` +
        `\n  failure storyboard : _output/${board && board.baseDir ? board.baseDir : '<scenario>'}.svg` +
        (board && board.rerun
          ? `\n  deliberate change? regenerate locally, then inspect: TASK_E2E_UPDATE_BASELINES=1 ${board.rerun}`
          : '')
    }
    throw err
  }
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
  // A newline is a deliberate paragraph break (several `# Note:` lines), kept
  // as one blank line so the card breathes instead of reading as a wall.
  String(text).split('\n').forEach((paragraph, index) => {
    if (index > 0) lines.push('')
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? line + ' ' + word : word
      if (candidate.length > perLine && line) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    if (line) lines.push(line)
  })
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
  fail: '#f7768e',
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
  pagePad: 32,
  gap: 24,
  textPad: 18
}

/**
 * Write the storyboard SVG. options.imageDir substitutes every frame with the
 * same-named PNG inside that directory — used to build the COMMITTED SVG from
 * the reviewed baselines instead of the run's actuals. options.failure (built
 * by the plugin on a failed test) marks the drifted card in red, embeds its
 * pixel-diff image as an extra card, and lists the sentences the journey
 * never reached — one downloadable artifact tells the whole debugging story.
 */
function render (outFile, options = {}) {
  if (!board || !board.panels.length) {
    throw new Error('storyboard.render() called with no panels')
  }
  const t = THEME
  const g = GRID
  const failure = options.failure || null
  const resolveImage = (file) =>
    options.imageDir ? path.join(options.imageDir, path.basename(file)) : file

  // One card per frame; a multi-frame panel repeats its number and title so
  // every card still reads as its Gherkin line. The card whose pixels drifted
  // is flagged (red chrome) — the full-width comparison band above the grid
  // carries its expected / diff / actual triptych.
  // Verbatim Gherkin keyword of a sentence (And/But included), coloured by
  // its resolved group so the grid scans as stage / actions / proofs.
  const lineOf = (title) => (board.lines || []).find(l => l.text === title)

  const failName = failure && failure.frame && failure.frame.name
  // note/copy precedence: per-frame value > JS panel value (opts/annotate,
  // e.g. a URL only known at runtime) > `# Note:` / `# Copy:` comment in the
  // .feature — the feature file is the default source of the human text.
  const cards = board.panels.flatMap((p, pi) => {
    const line = lineOf(p.title)
    return p.images.map((img, fi) => ({
      n: pi + 1,
      first: fi === 0,
      title: p.title,
      note: img.note !== undefined ? img.note : (fi === 0 ? (p.note || (line && line.note) || '') : ''),
      copy: img.copy !== undefined ? img.copy : (fi === 0 ? (p.copy || (line && line.copy) || '') : ''),
      file: resolveImage(img.file),
      failed: failName === path.basename(img.file)
    }))
  })
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

  // Draw an image letterboxed inside a box (scaled to fit, centred on the
  // slot colour), with an optional native <title> tooltip.
  const drawImage = (file, x, y, boxW, boxH, tooltip) => {
    const { w, h } = pngSize(file)
    const data = fs.readFileSync(file).toString('base64')
    const scale = Math.min(boxW / w, boxH / h)
    const dw = w * scale
    const dh = h * scale
    parts.push(`<rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" fill="${t.slot}"/>`)
    parts.push(
      `<image x="${(x + (boxW - dw) / 2).toFixed(1)}" y="${(y + (boxH - dh) / 2).toFixed(1)}"` +
      ` width="${dw.toFixed(1)}" height="${dh.toFixed(1)}" href="data:image/png;base64,${data}">` +
      (tooltip ? `<title>${esc(tooltip)}</title>` : '') + '</image>'
    )
  }

  // Full-width failure band, rendered IN PLACE of the drifted card (which is
  // always the last one — the assert throws there and stops the run): the
  // expected / diff / actual triptych read left→right (what it should be,
  // exactly which pixels changed, what this run produced), each image over
  // its full, copyable file path — zero ambiguity, all in one artifact.
  // Wrap a filesystem path onto up to `maxLines` lines, breaking on '/' (kept
  // attached to its segment) so no line overflows its slot. Path segments have
  // no spaces, so tspans concatenate back to the exact path on copy.
  const pathLines = (str, slotW, maxLines = 2) => {
    const perLine = Math.max(8, Math.floor(slotW / 6.6))
    const segments = String(str).split('/').map((s, i, a) => i < a.length - 1 ? s + '/' : s)
    const lines = []
    let line = ''
    for (const segment of segments) {
      if ((line + segment).length > perLine && line) { lines.push(line); line = segment } else { line += segment }
    }
    if (line) lines.push(line)
    return lines.slice(0, maxLines)
  }
  const bandPathH = 32
  const failBandHeight = () => 46 + 12 + 22 + 300 + bandPathH + 16
  const drawFailureBand = (frame, top) => {
    const bandW = width - 2 * g.pagePad
    const slotH = 300
    const headerH = 46
    const bandH = failBandHeight()
    parts.push(`<rect x="${g.pagePad}" y="${top}" width="${bandW}" height="${bandH}" rx="12" fill="${t.card}" stroke="${t.fail}" stroke-width="3"/>`)

    // Red header: which step and sentence regressed.
    parts.push(`<rect x="${g.pagePad}" y="${top}" width="${bandW}" height="${headerH}" rx="12" fill="${t.fail}"/>`)
    parts.push(`<rect x="${g.pagePad}" y="${top + headerH - 12}" width="${bandW}" height="12" fill="${t.fail}"/>`)
    text(`✖ Visual regression — step ${frame.step}: ${frame.keyword ? frame.keyword + ' ' : ''}${frame.sentence}`,
      g.pagePad + 18, top + 30, { size: 16, fill: '#ffffff', weight: '700' })
    text(frame.name, width - g.pagePad - 18, top + 30, { size: 12.5, fill: '#ffffff', font: t.mono, anchor: 'end' })

    const p = frame.paths || {}
    const gap = 16
    const slotW = (bandW - 2 * gap) / 3
    const cols = [
      { file: frame.baseline, label: 'Expected (baseline)', pathText: p.expected },
      { file: frame.diff, label: 'Diff — changed pixels', pathText: p.diff },
      { file: frame.actual, label: 'Actual (this run)', pathText: p.actual }
    ]
    cols.forEach((col, ci) => {
      const x = g.pagePad + ci * (slotW + gap)
      const ly = top + headerH + 12 + 15
      text(col.label, x + 2, ly, { size: 13, fill: ci === 1 ? t.fail : t.dim, weight: '600' })
      if (col.file && fs.existsSync(col.file)) {
        drawImage(col.file, x, ly + 8, slotW, slotH, col.pathText)
      } else {
        parts.push(`<rect x="${x}" y="${ly + 8}" width="${slotW}" height="${slotH}" fill="${t.slot}"/>`)
        text('(not generated)', x + slotW / 2, ly + 8 + slotH / 2, { size: 13, fill: t.dim, anchor: 'middle' })
      }
      // Full, one-click-copyable path to the file — open it or hand it to a
      // command without retyping. Wrapped on '/' so it never overflows.
      if (col.pathText) {
        const pl = pathLines(col.pathText, slotW)
        const tspans = pl.map((line, li) =>
          `<tspan x="${x + 2}" dy="${li === 0 ? 0 : 13}">${esc(line)}</tspan>`
        ).join('')
        parts.push(
          `<text x="${x + 2}" y="${ly + 8 + slotH + 14}" font-family="${t.mono}" font-size="11" fill="${t.accent}"` +
          ` class="copy" xml:space="preserve">${tspans}</text>`
        )
      }
    })
    return bandH
  }

  // Text block of a card. Glyph-width estimates are deliberately generous
  // (bold sans ≈ 9.3px/char at 15.5px) — an over-wrap is invisible, an
  // under-wrap bleeds into the next card.
  const layoutOf = (card) => {
    const line = lineOf(card.title)
    const keyword = line ? line.keyword : ''
    const title = wrap(`${keyword ? keyword + ' ' : ''}${card.title}`, textW, 9.3)
    const note = card.note ? wrap(card.note, textW, 7.2) : []
    const copy = card.copy ? wrap(card.copy, textW, 8.0) : []
    return { keyword, group: line ? line.group : '', title, note, copy, h: 16 + title.length * 21 + note.length * 18 + (copy.length ? 6 + copy.length * 18 : 0) + 16 }
  }

  // ADAPTIVE slots: the image is shown at natural size (downscaled only when
  // wider than the card or taller than MAX_SLOT_H — never upscaled, terminal
  // text must stay crisp) and the slot HUGS it: a 3-line verdict gets a short
  // card, a 90-line one gets a tall card. Cards on the same ROW share the
  // row's tallest slot/text so the grid stays aligned without drowning short
  // frames in letterbox.
  const MAX_SLOT_H = 1100
  const slotOf = (card) => {
    const { w, h } = pngSize(card.file)
    const scale = Math.min(1, g.cardW / w, MAX_SLOT_H / h)
    return { scale, dispW: w * scale, dispH: h * scale }
  }
  // Cards flow in READING ORDER, two per row, and the two cards of a row are
  // fully UNIFORM: one shared image slot (as tall as the row's tallest frame —
  // a smaller frame is centred inside it) and one shared text zone starting at
  // the same height in both cards. The top BADGE_BAND of every card is
  // reserved for the number badge so it never covers the first line of a
  // frame. A `# Chapter:` comment in the .feature closes the current row and
  // inserts a full-width chapter band — that is how a 20-card story keeps a
  // beginning, a middle and an end.
  const BADGE_BAND = 28
  const CHAPTER_BAND = 56
  const slots2d = []
  const chapterBands = []
  let rowTop = 0
  let row = []
  const flushRow = () => {
    if (!row.length) return
    const rowSlot = Math.max(...row.map(i => BADGE_BAND + Math.ceil(slotOf(cards[i]).dispH)))
    const rowText = Math.max(...row.map(i => Math.ceil(layoutOf(cards[i]).h)))
    row.forEach((cardIndex, col) => {
      slots2d[cardIndex] = { col, top: rowTop, slotH: rowSlot, h: rowSlot + rowText }
    })
    rowTop += rowSlot + rowText + g.gap
    row = []
  }
  cards.forEach((card, i) => {
    const line = lineOf(card.title)
    if (card.first && line && line.chapter) {
      flushRow()
      chapterBands.push({ title: line.chapter, top: rowTop, n: chapterBands.length + 1 })
      rowTop += CHAPTER_BAND + g.gap
    }
    if (row.length === g.cols) flushRow()
    row.push(i)
  })
  flushRow()
  const gridHeight = cards.length ? rowTop - g.gap : 0

  // --- Header: feature left (wrapped, never under the right column), the
  // scenario under it, file path top-right, then the rerun bar. ---
  const drawHeader = () => {
    const rightZone = 470
    const titleW = width - 2 * g.pagePad - rightZone
    let hy = 54
    for (const line of wrap(board.feature, titleW, 16.8)) {
      text(line, g.pagePad, hy, { size: 28, weight: '700' })
      hy += 34
    }
    for (const line of wrap('Scenario: ' + board.scenario, titleW, 8.7)) {
      text(line, g.pagePad, hy - 6, { size: 15, fill: t.dim })
      hy += 20
    }
    if (board.file) {
      text(board.file, width - g.pagePad, 44, { size: 12, fill: t.dim, font: t.mono, anchor: 'end' })
      text('e2e storyboard · baseline', width - g.pagePad, 62, { size: 12, fill: t.dim, anchor: 'end' })
    }
    hy = Math.max(hy + 8, 104)
    if (board.rerun) {
      parts.push(`<rect x="${g.pagePad}" y="${hy}" width="${width - 2 * g.pagePad}" height="36" rx="8" fill="${t.codeBg}"/>`)
      text('replay this scenario', g.pagePad + 16, hy + 23, { size: 12.5, fill: t.dim })
      copyText(board.rerun, g.pagePad + 170, hy + 23, { size: 13 })
      hy += 36
    }
    return hy + 28
  }

  // --- Footer: failure band (in place of the drifted card), the sentences
  // never reached, the verdict line and the colour legend. ---
  const drawFooter = (fy) => {
    if (failure && failure.frame) {
      if (cards.length) fy += g.gap
      fy += drawFailureBand(failure.frame, fy)
    }
    if (failure && failure.notReached && failure.notReached.length) {
      fy += 34
      for (const line of failure.notReached) {
        text('○', g.pagePad + 4, fy, { size: 13, fill: t.dim, weight: '600' })
        text(`${line.keyword} ${line.text} — not reached`, g.pagePad + 26, fy, { size: 13.5, fill: t.dim })
        fy += 20
      }
    }
    fy += 30
    const proven = board.panels.filter(p => p.images.length).length
    const verdict = failure
      ? `FAILED — ${proven} of ${(board.lines || []).length || board.panels.length} sentences proven · the red band shows where it broke (expected / diff / actual)`
      : `Storyboard e2e · ${board.panels.length} steps · ${cards.length} frames · every frame is its own pixel baseline (tolerance: 0)`
    text(verdict, g.pagePad, fy, { size: failure ? 12.5 : 12, fill: failure ? t.fail : t.dim, weight: failure ? '600' : 'normal' })
    parts.push(
      `<text x="${width - g.pagePad}" y="${fy}" font-family="${t.sans}" font-size="12" fill="${t.dim}" text-anchor="end">` +
      `<tspan fill="${t.given}">●</tspan> Given — stage   <tspan fill="${t.when}">●</tspan> When — actions   ` +
      `<tspan fill="${t.then}">●</tspan> Then — proofs</text>`
    )
    return fy
  }

  let y = drawHeader()

  // --- Chapter bands: full-width titled strips between rows. ---
  chapterBands.forEach((band) => {
    const bw = width - 2 * g.pagePad
    parts.push(`<rect x="${g.pagePad}" y="${y + band.top}" width="${bw}" height="${CHAPTER_BAND}" rx="10" fill="${t.codeBg}"/>`)
    parts.push(`<rect x="${g.pagePad}" y="${y + band.top}" width="6" height="${CHAPTER_BAND}" fill="${t.accent}"/>`)
    text(`Chapter ${band.n}`, g.pagePad + 26, y + band.top + 35, { size: 17, fill: t.accent, weight: '700' })
    text(band.title, g.pagePad + 26 + 9.5 * `Chapter ${band.n}`.length + 18, y + band.top + 35, { size: 17, weight: '600' })
  })

  // --- Cards (every captured frame, the drifted one red-outlined). Rows have
  // their own heights; inside a row every card is top-aligned. ---
  cards.forEach((card, i) => {
    const { scale, dispW, dispH } = slotOf(card)
    const slotH = slots2d[i].slotH
    const cardH = slots2d[i].h
    const cx = g.pagePad + slots2d[i].col * (g.cardW + g.gap)
    const cy = y + slots2d[i].top

    parts.push(`<clipPath id="card${i}"><rect x="${cx}" y="${cy}" width="${g.cardW}" height="${cardH}" rx="12"/></clipPath>`)
    parts.push(
      `<rect x="${cx}" y="${cy}" width="${g.cardW}" height="${cardH}" rx="12" fill="${t.card}"` +
      (card.failed ? ` stroke="${t.fail}" stroke-width="3"` : '') + '/>'
    )
    parts.push(`<g clip-path="url(#card${i})">`)
    // The image at NATURAL size (downscaled only when oversized), centred both
    // ways inside the ROW's shared slot: the two cards of a row keep the same
    // image zone and the same text zone, whatever each frame's own size.
    parts.push(`<rect x="${cx}" y="${cy}" width="${g.cardW}" height="${slotH}" fill="${t.slot}"/>`)
    const data = fs.readFileSync(card.file).toString('base64')
    const iy = cy + BADGE_BAND + (slotH - BADGE_BAND - Math.ceil(dispH)) / 2
    parts.push(
      `<image x="${(cx + (g.cardW - dispW) / 2).toFixed(1)}" y="${iy.toFixed(1)}"` +
      ` width="${dispW.toFixed(1)}" height="${dispH.toFixed(1)}" href="data:image/png;base64,${data}">` +
      `<title>${esc(path.basename(card.file))}${scale < 1 ? ` (shown at ${(scale * 100).toFixed(0)}%)` : ''}</title></image>`
    )

    const layout = layoutOf(card)
    let ty = cy + slotH + 16 + 15
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
    parts.push('</g>')

    // Number badge astride the card's TOP-LEFT CORNER — on the chrome, never
    // over the captured pixels.
    parts.push(`<circle cx="${cx + 4}" cy="${cy + 4}" r="16" fill="${card.failed ? t.fail : t.badge}"/>`)
    text(String(card.n), cx + 4, cy + 9, { size: 15, fill: '#ffffff', weight: '700', anchor: 'middle' })
  })

  if (cards.length) y += gridHeight
  y = drawFooter(y)

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

// Build the failure descriptor for a failed test: the drifted frame (marked
// exactly by addStoryboardFrame via board.visualFailure) with its
// expected/diff/actual paths, plus the sentences never reached. Returns null
// when nothing was marked.
function buildFailure (board) {
  const dir = global.codecept_dir
  const marked = board.panels.find(p => p.images.some(img => path.basename(img.file) === board.visualFailure))
  const notReached = (board.lines || []).filter(line =>
    !board.panels.some(p => p.title === line.text && p.images.length)
  )
  if (!board.visualFailure || !marked) return { frame: null, notReached }

  const name = board.visualFailure
  const diffPath = path.join(dir, 'screenshots', 'diff', board.baseDir, `Diff_${name}`)
  const hasDiff = fs.existsSync(diffPath)
  const baseline = path.join(dir, 'screenshots', 'base', board.baseDir, name)
  const actual = path.join(dir, '_output', board.baseDir, name)
  const line = (board.lines || []).find(l => l.text === marked.title)
  const rel = (abs) => path.relative(process.cwd(), abs)
  return {
    frame: {
      name,
      step: board.panels.indexOf(marked) + 1,
      sentence: marked.title,
      keyword: line ? line.keyword : '',
      baseline,
      actual,
      diff: hasDiff ? diffPath : null,
      paths: {
        expected: rel(baseline),
        diff: hasDiff ? rel(diffPath) : '(no pixel diff — see the error message, e.g. image dimensions differ)',
        actual: rel(actual)
      }
    },
    notReached
  }
}

// One unmissable block in the runner output: WHERE to look. The path is
// repo-relative — valid on the host once the artifact sync (end of the run)
// has copied _output back.
function logVisualRegression (frame, outputSvg) {
  console.error(
    '\n════════════════════════════════════════════════════════════════\n' +
    `✖ VISUAL REGRESSION — step ${frame.step}: ${frame.keyword} ${frame.sentence}\n` +
    '  The failure storyboard sums it all up (expected / diff / actual):\n' +
    `  🎬 open in a browser:  ${path.relative(process.cwd(), outputSvg)}\n` +
    '  (file available on the host after the artifact sync at the end of the run)\n' +
    '════════════════════════════════════════════════════════════════\n'
  )
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
      if (!fromFeatures.startsWith('..')) {
        // FLAT per-scenario layout: <feature-dir>/<scenario-tag> — the film
        // reads as acts/stories with no per-feature nesting. Scenario tags are
        // grep filters, unique by construction, so they key the baselines and
        // the SVG unambiguously.
        const scenarioKey = tag
          ? tag.replace(/^@/, '')
          : stripTags(test.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        base = path.join(path.dirname(fromFeatures), scenarioKey)
      }
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

  // Every Gherkin sentence opens its own card AUTOMATICALLY, in scenario
  // order, right before its step function runs — frames captured inside the
  // step attach to it. Step files never do panel bookkeeping.
  event.dispatcher.on(event.bddStep.before, (step) => {
    if (!board) return
    panel(step.text)
  })

  const finish = (passed) => {
    // Only scenarios that actually captured frames are storyboards — plain
    // Gherkin tests (no addStoryboardFrame call) must not render empty boards.
    if (!board || !board.panels.some(p => p.images.length) || !board.baseDir || !global.codecept_dir) return
    try {
      // The drifted frame was marked exactly by addStoryboardFrame; on a
      // diff-less failure (e.g. "Image dimensions do not match") the band's
      // middle slot reads "(not generated)".
      const failure = passed ? null : buildFailure(board)
      const outputSvg = render(path.join(global.codecept_dir, '_output', `${board.baseDir}.svg`), { failure })
      if (failure && failure.frame) logVisualRegression(failure.frame, outputSvg)
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
module.exports.captureElementFrame = captureElementFrame
module.exports.frameOutputPath = frameOutputPath
module.exports.assertOrUpdateBaseline = assertOrUpdateBaseline
module.exports.addStoryboardFrame = addStoryboardFrame
module.exports.render = render
module.exports.tryTo = tryTo
