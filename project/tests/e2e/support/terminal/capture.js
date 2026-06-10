/**
 * Real-terminal (ttyd + xterm.js) visual capture engine.
 *
 * Extracted from the legacy bootstrap suite (step_definitions/ttyd_steps.js)
 * into a focused, reusable module so the unified e2e suite can screenshot a
 * REAL terminal as the developer truly sees it — not a synthetic <pre>
 * re-render of captured stdout.
 *
 * Every function takes the CodeceptJS actor `I` explicitly (this is a plain
 * helper module, not a step file), and drives the live xterm DOM rendered by
 * ttyd (`-t rendererType=dom`, set in project/ubuntu/Dockerfile). The
 * deterministic "compact capture" rebuilds the visible rows into an isolated
 * shadow-DOM block so the screenshot is reproducible at tolerance:0 across
 * local and CI runners.
 */

const fs = require('fs')
const path = require('path')

// Resolve baseline/actual dirs relative to the e2e config dir (support/terminal
// -> e2e), independent of the codeceptjs working directory.
const E2E_DIR = path.resolve(__dirname, '..', '..')

const TERMINAL_SETTLE_TIMEOUT_SECONDS = 20
const TERMINAL_SETTLE_POLL_SECONDS = 0.25
const TERMINAL_SETTLE_STABLE_SAMPLES = 3
const TERMINAL_BOTTOM_TOLERANCE_PX = 12

const SHELL_PROMPT_RE = /bootstrap@workspace:[^\r\n]*\$\s*$/
const PROMPT_STABILITY_MS = 2000
const PROMPT_POLL_SECONDS = 1
const COMMAND_TIMEOUT_MS = 900000

const COMPACT_CAPTURE_ID = '__ttyd_compact_capture__'

// Lines matching these patterns are dropped from the capture before the
// visual assertion. They represent install-time noise whose exact content
// or ordering is non-deterministic across runs (apt / go / uv / npm).
const TERMINAL_NOISE_PATTERNS = [
  /^\(Reading database/,
  /^Preparing to unpack /,
  /^Unpacking /,
  /^Selecting previously unselected package/,
  /^Setting up /,
  /^Processing triggers for /,
  /^debconf: /,
  /^downloading /,
  /^Downloading \S+ \(/,
  /^Installed \d+ packages? in /,
  /^Resolved \d+ packages? in /,
  /^ \+ \S+==/,
  /^Prepared \d+ packages? in /,
  /^Audited \d+ packages? in /,
  /^go: downloading /,
  /^go: finding /,
  /^go: extracting /,
  /^Get:\d+ /,
  /^Fetched [\d.]+ .?B in /,
  /^Need to get /,
  /^After this operation, /,
  /^\d+ upgraded, /,
  /^update-alternatives: /,
  /^Reading package lists/,
  /^Building dependency tree/,
  /^Reading state information/,
  /^The following additional packages/,
  /^The following NEW packages/,
  /^\s+python3-/,
  /^npm notice/,
  /^added \d+ packages?, and audited /,
  /^\d+ packages? are looking for funding/,
  /^ {2}run `npm fund`/,
  /^found \d+ vulnerabilities/
]

async function readTerminalState (I) {
  return I.executeScript(function (bottomTolerancePx) {
    const viewport = document.querySelector('.xterm-viewport')
    const screen = document.querySelector('.xterm-screen')

    if (!viewport || !screen) {
      return null
    }

    const textLength = (screen.textContent || '').length
    const scrollHeight = viewport.scrollHeight
    const clientHeight = viewport.clientHeight
    const scrollTop = viewport.scrollTop
    const expectedBottom = Math.max(0, scrollHeight - clientHeight)
    const atBottom = Math.abs(scrollTop - expectedBottom) <= bottomTolerancePx

    return { scrollHeight, clientHeight, scrollTop, textLength, atBottom }
  }, TERMINAL_BOTTOM_TOLERANCE_PX)
}

async function waitForTerminalSettle (I, timeoutSeconds = TERMINAL_SETTLE_TIMEOUT_SECONDS) {
  const startedAt = Date.now()
  let stableSamples = 0
  let previousState = null
  let latestState = null

  while ((Date.now() - startedAt) < (timeoutSeconds * 1000)) {
    latestState = await readTerminalState(I)
    if (!latestState) {
      await I.wait(TERMINAL_SETTLE_POLL_SECONDS)
      continue
    }

    const isStable = previousState &&
      previousState.scrollHeight === latestState.scrollHeight &&
      previousState.scrollTop === latestState.scrollTop &&
      previousState.textLength === latestState.textLength

    stableSamples = isStable ? stableSamples + 1 : 0
    previousState = latestState

    if (stableSamples >= TERMINAL_SETTLE_STABLE_SAMPLES) {
      return latestState
    }

    await I.wait(TERMINAL_SETTLE_POLL_SECONDS)
  }

  return latestState
}

async function scrollTerminalToBottom (I) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const state = await I.executeScript(function (bottomTolerancePx) {
      const viewport = document.querySelector('.xterm-viewport')
      if (!viewport) {
        return null
      }
      const expectedBottom = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      viewport.scrollTop = expectedBottom

      return { atBottom: Math.abs(viewport.scrollTop - expectedBottom) <= bottomTolerancePx }
    }, TERMINAL_BOTTOM_TOLERANCE_PX)

    if (state && state.atBottom) {
      return true
    }

    await I.wait(0.2)
  }

  return false
}

async function readLastNonEmptyRenderedRow (I) {
  return I.executeScript(function () {
    const rows = document.querySelectorAll('.xterm-rows > div')
    for (let i = rows.length - 1; i >= 0; i--) {
      const text = rows[i].textContent || ''
      if (text.replace(/\s+$/, '').length > 0) return text
    }
    return ''
  })
}

/**
 * Poll the live terminal until the interactive shell prompt returns and
 * stays visible for PROMPT_STABILITY_MS (proving the command finished),
 * then wait for the screen to stop changing.
 */
async function waitForPromptReturn (I, command, timeoutMs = COMMAND_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  let promptSeenSince = null
  let lastLine = ''
  while (Date.now() < deadline) {
    lastLine = await readLastNonEmptyRenderedRow(I)
    if (SHELL_PROMPT_RE.test(lastLine)) {
      if (promptSeenSince === null) promptSeenSince = Date.now()
      if (Date.now() - promptSeenSince >= PROMPT_STABILITY_MS) return
    } else {
      promptSeenSince = null
    }
    await I.wait(PROMPT_POLL_SECONDS)
  }
  throw new Error(
    `Timed out waiting for shell prompt after command "${command}" (${timeoutMs}ms)\n` +
    `--- Last rendered row: ${JSON.stringify(lastLine)}`
  )
}

/**
 * Type a command into the live xterm, run it, and wait for the prompt to
 * return and the screen to settle.
 */
async function typeCommandAndWait (I, command, timeoutMs = COMMAND_TIMEOUT_MS) {
  I.click('.xterm-screen')
  I.type(command)
  I.pressKey('Enter')
  await I.wait(2)
  await waitForPromptReturn(I, command, timeoutMs)
  await waitForTerminalSettle(I)
}

/**
 * Wait until the live terminal renders `expectedText` anywhere on screen.
 * Used to step through interactive prompts (e.g. Copier questions) that do
 * NOT return the shell prompt.
 */
async function waitForTerminalText (I, expectedText, timeoutMs = COMMAND_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  let screenText = ''
  while (Date.now() < deadline) {
    screenText = await I.executeScript(function () {
      const screen = document.querySelector('.xterm-screen')
      return screen ? (screen.textContent || '') : ''
    })
    if (screenText.includes(expectedText)) {
      await waitForTerminalSettle(I)
      return
    }
    await I.wait(PROMPT_POLL_SECONDS)
  }
  throw new Error(
    `Timed out waiting for terminal text ${JSON.stringify(expectedText)} (${timeoutMs}ms)\n` +
    `--- Current screen:\n${screenText || '<empty>'}`
  )
}

async function buildCompactTerminalCapture (I, captureId, patternSources, fromMarker = null, maxRows = 0) {
  return I.executeScript(function (args) {
    const id = args.id
    const sources = args.sources
    const fromMarker = args.fromMarker
    const maxRows = args.maxRows
    const patterns = sources.map(function (src) { return new RegExp(src) })
    const screen = document.querySelector('.xterm-screen')
    if (!screen) return { kept: 0, error: 'no-xterm-screen' }

    const screenStyles = window.getComputedStyle(screen)

    function resolveOpaqueBackground () {
      const candidates = [
        document.querySelector('.xterm-viewport'),
        document.querySelector('.terminal'),
        document.querySelector('.xterm'),
        document.body,
        document.documentElement
      ]
      for (let i = 0; i < candidates.length; i++) {
        const el = candidates[i]
        if (!el) continue
        const bg = window.getComputedStyle(el).backgroundColor
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
          return bg
        }
      }
      return 'rgb(0, 0, 0)'
    }

    const opaqueBackground = resolveOpaqueBackground()

    const previous = document.getElementById(id)
    if (previous) previous.remove()

    const rowNodes = Array.from(document.querySelectorAll('.xterm-rows > div'))
    if (rowNodes.length === 0) return { kept: 0, error: 'no-rows' }

    const sampleStyles = window.getComputedStyle(rowNodes[0])
    let rowHeight = parseFloat(sampleStyles.height) || 0
    if (!rowHeight || rowHeight < 4) {
      const sorted = rowNodes
        .map(function (row) { return parseFloat(row.style.top || '0') || 0 })
        .sort(function (a, b) { return a - b })
      for (let i = 1; i < sorted.length; i++) {
        const delta = sorted[i] - sorted[i - 1]
        if (delta > 0) { rowHeight = delta; break }
      }
    }
    if (!rowHeight || rowHeight < 4) rowHeight = 17

    let sortedRows = rowNodes
      .map(function (row) {
        return { row, top: parseFloat(row.style.top || '0') || 0 }
      })
      .sort(function (a, b) { return a.top - b.top })

    // Anchor the capture on a marker (e.g. an interactive prompt line) so the
    // non-deterministic install scrollback above it is excluded. Keep every
    // row from the FIRST row containing the marker onward.
    if (fromMarker) {
      let startIndex = -1
      for (let i = 0; i < sortedRows.length; i++) {
        if ((sortedRows[i].row.textContent || '').indexOf(fromMarker) !== -1) {
          startIndex = i
          break
        }
      }
      if (startIndex > 0) {
        sortedRows = sortedRows.slice(startIndex)
      }
    }

    // Bound the capture to the first `maxRows` rows from the anchor, so a
    // deterministic milestone block can be isolated from the non-deterministic
    // output that follows it (e.g. toolchain downloads after "Template source").
    if (maxRows && sortedRows.length > maxRows) {
      sortedRows = sortedRows.slice(0, maxRows)
    }

    // Build a shadow root to fully isolate from xterm CSS rules.
    const host = document.createElement('div')
    host.id = id
    host.style.setProperty('position', 'fixed', 'important')
    host.style.setProperty('top', '0', 'important')
    host.style.setProperty('left', '0', 'important')
    host.style.setProperty('z-index', '2147483647', 'important')
    host.style.setProperty('margin', '0', 'important')
    host.style.setProperty('padding', '0', 'important')
    host.style.setProperty('background', opaqueBackground, 'important')

    const shadow = host.attachShadow({ mode: 'open' })

    const style = document.createElement('style')
    style.textContent = [
      ':host { display: block; margin: 0; padding: 0; }',
      '.wrap {',
      '  display: block;',
      '  margin: 0;',
      '  padding: 0;',
      '  box-sizing: content-box;',
      '  font-family: ' + screenStyles.fontFamily + ';',
      '  font-size: ' + screenStyles.fontSize + ';',
      '  font-weight: ' + screenStyles.fontWeight + ';',
      '  letter-spacing: ' + screenStyles.letterSpacing + ';',
      '  line-height: ' + rowHeight + 'px;',
      '  color: ' + screenStyles.color + ';',
      '  background: ' + opaqueBackground + ';',
      '  white-space: pre;',
      '}',
      '.row {',
      '  display: block;',
      '  position: static;',
      '  margin: 0;',
      '  padding: 0;',
      '  border: 0;',
      '  height: ' + rowHeight + 'px;',
      '  min-height: ' + rowHeight + 'px;',
      '  max-height: ' + rowHeight + 'px;',
      '  line-height: ' + rowHeight + 'px;',
      '  overflow: hidden;',
      '  white-space: pre;',
      '}',
      '.row > span { display: inline; vertical-align: baseline; }'
    ].join('\n')
    shadow.appendChild(style)

    const wrap = document.createElement('div')
    wrap.className = 'wrap'
    shadow.appendChild(wrap)

    let kept = 0
    let maxChars = 0

    sortedRows.forEach(function (entry) {
      const rawText = entry.row.textContent || ''
      const trimmed = rawText.replace(/\s+$/, '')
      if (trimmed === '') return
      if (patterns.some(function (re) { return re.test(trimmed) })) return

      const line = document.createElement('div')
      line.className = 'row'

      // Clone child nodes but stop once we've emitted up to `trimmed.length`
      // chars so trailing whitespace-only spans don't bloat the row width.
      let emitted = 0
      const limit = trimmed.length

      Array.from(entry.row.childNodes).some(function (node) {
        if (emitted >= limit) return true

        if (node.nodeType === 3) {
          const textValue = node.textContent || ''
          const take = Math.min(textValue.length, limit - emitted)
          if (take > 0) {
            line.appendChild(document.createTextNode(textValue.slice(0, take)))
            emitted += take
          }
          return false
        }

        if (node.nodeType !== 1) return false

        const nodeText = node.textContent || ''
        const take = Math.min(nodeText.length, limit - emitted)
        if (take <= 0) return emitted >= limit

        const sourceStyle = window.getComputedStyle(node)
        const span = document.createElement('span')
        span.textContent = nodeText.slice(0, take)
        span.style.setProperty('color', sourceStyle.color, 'important')
        span.style.setProperty('background-color', sourceStyle.backgroundColor, 'important')
        span.style.setProperty('font-weight', sourceStyle.fontWeight, 'important')
        span.style.setProperty('font-style', sourceStyle.fontStyle, 'important')
        span.style.setProperty('text-decoration', sourceStyle.textDecoration, 'important')
        line.appendChild(span)
        emitted += take

        return false
      })

      wrap.appendChild(line)
      kept++

      if (trimmed.length > maxChars) maxChars = trimmed.length
    })

    host.style.setProperty('height', (kept * rowHeight) + 'px', 'important')
    wrap.style.setProperty('display', 'inline-block', 'important')
    wrap.style.setProperty('height', (kept * rowHeight) + 'px', 'important')

    document.body.appendChild(host)

    // Measure natural width after DOM insertion so the host bounds tightly.
    const naturalWidth = wrap.getBoundingClientRect().width
    const finalWidth = Math.ceil(naturalWidth) + 2
    host.style.setProperty('width', finalWidth + 'px', 'important')

    return { kept, width: finalWidth, rowHeight, maxChars }
  }, { id: captureId, sources: patternSources, fromMarker, maxRows })
}

async function removeCompactTerminalCapture (I, captureId) {
  return I.executeScript(function (id) {
    const el = document.getElementById(id)
    if (el) el.remove()
  }, captureId)
}

/**
 * Settle the live terminal, rebuild the deterministic compact capture and
 * assert it visually matches the baseline (tolerance:0). The window is pinned
 * to 1920x1080 during capture then restored.
 */
async function assertTerminalVisualMatch (I, baselineName, opts = {}) {
  await I.wait(1)
  I.resizeWindow(1920, 1080)
  await I.wait(2)

  await waitForTerminalSettle(I)
  await scrollTerminalToBottom(I)
  await I.wait(0.5)

  const info = await buildCompactTerminalCapture(
    I,
    COMPACT_CAPTURE_ID,
    TERMINAL_NOISE_PATTERNS.map(function (re) { return re.source }),
    opts.fromMarker || null,
    opts.maxRows || 0
  )
  if (!info || !info.kept) {
    await removeCompactTerminalCapture(I, COMPACT_CAPTURE_ID)
    throw new Error(`Compact terminal capture produced no rows for "${baselineName}" (info=${JSON.stringify(info)})`)
  }

  await I.wait(0.2)
  await I.captureScreenshot(baselineName, 'actual', '#' + COMPACT_CAPTURE_ID)

  // Baseline-update mode (TASK_E2E_UPDATE_BASELINES=1): assert first and only
  // when the assert FAILS persist the freshly captured (element-cropped)
  // actual as the baseline — green baselines stay byte-identical, so a
  // regeneration run produces no churn. The VisualHelper auto-creates a
  // FULL-PAGE baseline on a missing one, which never matches the element crop,
  // so missing baselines land in the failure path and get the correct crop.
  // Each baseline produced this way MUST be inspected by a human, which is why
  // the mode is refused in CI: there it would silently swallow every terminal
  // visual regression.
  if (process.env.TASK_E2E_UPDATE_BASELINES && process.env.CI) {
    throw new Error('TASK_E2E_UPDATE_BASELINES is forbidden in CI — baselines must be regenerated and inspected locally')
  }

  try {
    if (process.env.TASK_E2E_UPDATE_BASELINES) {
      // tryTo: the recorder marks the test failed on a plain try/catch around
      // an actor call; the global tryTo (enabled plugin) is the supported way
      // to probe an assert.
      // eslint-disable-next-line no-undef
      const matches = await tryTo(() => I.assertVisualMatch(baselineName, { captureActual: false }))
      if (!matches) {
        const actualPath = path.join(E2E_DIR, '_output', baselineName + '.png')
        const baselinePath = path.join(E2E_DIR, 'screenshots', 'base', baselineName + '.png')
        fs.mkdirSync(path.dirname(baselinePath), { recursive: true })
        fs.copyFileSync(actualPath, baselinePath)
      }
    } else {
      await I.assertVisualMatch(baselineName, { captureActual: false })
    }
  } finally {
    await removeCompactTerminalCapture(I, COMPACT_CAPTURE_ID)
    I.resizeWindow(1024, 768)
    await I.wait(1)
  }
}

module.exports = {
  TERMINAL_NOISE_PATTERNS,
  SHELL_PROMPT_RE,
  COMPACT_CAPTURE_ID,
  COMMAND_TIMEOUT_MS,
  readTerminalState,
  waitForTerminalSettle,
  scrollTerminalToBottom,
  readLastNonEmptyRenderedRow,
  waitForPromptReturn,
  typeCommandAndWait,
  waitForTerminalText,
  buildCompactTerminalCapture,
  removeCompactTerminalCapture,
  assertTerminalVisualMatch
}
