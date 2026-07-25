/**
 * Deterministic filtering + <pre> frame rendering for the guidance/auth
 * storyboard family (01-install: init-guidance + glab-auth-ensure). ONE place for the noise
 * patterns, the tail anchoring and the verdict renderer so every guidance card
 * filters the exact same way — those patterns are load-bearing for tolerance:0.
 *
 * The captured command is a plain `task devsecops:init` / `task glab:auth:ensure`
 * run in a fresh Ubuntu container; its combined stdout/stderr is rendered as a
 * dark <pre> block (no ttyd round-trip) and asserted pixel-perfect. Volatile
 * install noise (apt / Go / tool versions) is dropped and the visual window is
 * anchored on the deterministic verdict markers.
 */
const {
  addStoryboardFrame,
  captureElementFrame
} = require('../../../../../.config/codeceptjs/storyboard')
const { ansiToHtml } = require('./textRender')

// Keep the visual tail short: these runs emit a lot of apt/Go/glab install
// noise upstream of the deterministic verdict. 12 lines capture the last
// meaningful phase markers without remounting into upstream noise.
const VISUAL_TAIL_LINES = 12

function stripAnsi (str) {
  return String(str)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07]*\x07/g, '')
}

// Lines whose content varies between runs (IDs, task-runner headers, apt/Go/
// tool-install output) must be filtered before rendering so the pixel-perfect
// baseline stays reproducible.
const OUTPUT_NOISE_PATTERNS = [
  /^\{"id":\d+/,
  /^🦊 Applying merge request settings/,
  /^task: \[/,
  /Creating new Project Access Token .*expires \d{4}-\d{2}-\d{2}/,
  // Go module downloads (parallel → non-deterministic order); the phase-complete
  // line that follows is deterministic and sufficient proof.
  /^go: /,
  // Lefthook iterates a Go map for the hook list → non-deterministic order.
  /^sync hooks: /,
  // apt-get output during `task dev:setup-environment` — the deterministic
  // phase markers downstream are sufficient proof.
  /^Setting up /,
  /^Unpacking /,
  /^Preparing to unpack /,
  /^Selecting previously /,
  /^Processing triggers /,
  /^\(Reading database /,
  // Go / glab / gum / glow install lines (versions move at each run).
  /^go installed successfully:/,
  /^Detected GOROOT:/,
  /^Creating symlink:/,
  /^Adding Go environment/,
  /^GOROOT=/,
  /^GOPATH=/,
  /^Installing (glab|gum|glow) v/,
  /^Attempting installation/,
  /^(glab|gum|glow) installed to /,
  /^✅ glab installed successfully/,
  /^Installation complete!$/,
  /^glab \d+\.\d+\.\d+ /,
  /^update-alternatives:/
]

// The deterministic last lines of every guidance/auth verdict block: init
// completion, the auth/remote remediation footers, the missing-bin gum box
// footer. The window ends at the LAST marker match so trailing setup noise
// cannot shift it between runs.
const TAIL_MARKERS = [
  '✅ DevSecOps project initialization completed', // disabled / opt-out success
  'then rerun  task devsecops:init', //              missing-auth + host-detection
  'install     glab', //                             missing-bin gum box footer
  '  task devsecops:init' //                          gum/glow fast-fail + align-remote
]

// Anchor the tail on a known marker so trailing setup noise cannot shift the
// visual window between runs. Falls back to the last `tail` lines if no marker
// is present.
function tailFromMarker (lines, markers, tail = VISUAL_TAIL_LINES) {
  const markerIdx = lines.reduce(
    (last, line, idx) => (markers.some(m => line.includes(m)) ? idx : last),
    -1
  )
  if (markerIdx < 0) return lines.slice(Math.max(0, lines.length - tail))
  const end = markerIdx + 1
  return lines.slice(Math.max(0, end - tail), end)
}

function filterOutput (raw) {
  return stripAnsi(raw)
    .replace(/\r/g, '')
    .split('\n')
    .filter(line => {
      const trimmed = line.trim()
      if (trimmed === '') return true
      return !OUTPUT_NOISE_PATTERNS.some(re => re.test(trimmed))
    })
}

// Render deterministic text to a dark <pre> and capture it as a storyboard
// frame (asserted pixel-perfect against its own baseline inside the step).
// The text keeps the REAL terminal colours a command emitted: ansiToHtml turns
// its ANSI codes into spans, and escapes plain text exactly as before, so
// monochrome baselines stay byte-identical.
async function renderPreFrame (I, frameName, text, height = 640) {
  I.resizeWindow(1024, height)
  await I.usePlaywrightTo('render captured output in browser', async ({ page }) => {
    await page.setContent(
      '<!DOCTYPE html><html><body style="background:#1e1e1e;margin:0">' +
      // The box hugs its content: the element-cropped frame is exactly the
      // verdict text plus padding — a 3-line verdict yields a small frame,
      // never a mostly-empty viewport.
      '<div id="task-output-box" style="display:inline-block;background:#1e1e1e;padding:16px 22px 16px 16px;max-width:992px">' +
      '<pre id="task-output" style="margin:0;color:#d4d4d4;font-family:monospace;font-size:14px;line-height:1.4;white-space:pre-wrap;word-break:break-all">' +
      ansiToHtml(text) +
      '</pre></div></body></html>'
    )
  })
  await I.wait(0.5)
  await addStoryboardFrame(I, await captureElementFrame(I, frameName, '#task-output-box'))
  I.resizeWindow(1024, 768)
}

// The verdict frame: the last deterministic lines of a captured init/auth run,
// noise filtered and anchored on its remediation marker.
async function renderVerdictFrame (I, frameName, rawOutput) {
  const tail = tailFromMarker(filterOutput(rawOutput), TAIL_MARKERS, VISUAL_TAIL_LINES)
  await renderPreFrame(I, frameName, tail.join('\n'))
}

// Programmatic twins of the visual verdict — a card without one is not a proof.
function assertContains (output, expected) {
  const cleaned = stripAnsi(output)
  if (!cleaned.includes(expected)) {
    throw new Error(
      `Expected captured output to contain ${JSON.stringify(expected)}\n---\n${cleaned}\n---`
    )
  }
}

function assertNotContains (output, forbidden) {
  const cleaned = stripAnsi(output)
  if (cleaned.includes(forbidden)) {
    throw new Error(
      `Expected captured output NOT to contain ${JSON.stringify(forbidden)}\n---\n${cleaned}\n---`
    )
  }
}

function assertNonZeroExit (exitCode, output) {
  if (exitCode === 0) {
    throw new Error(`Expected a non-zero exit, got 0\n--- captured output ---\n${output}\n---`)
  }
}

function assertZeroExit (exitCode, output) {
  if (exitCode !== 0) {
    throw new Error(`Expected exit 0, got ${exitCode}\n--- captured output ---\n${output}\n---`)
  }
}

module.exports = {
  stripAnsi,
  filterOutput,
  tailFromMarker,
  TAIL_MARKERS,
  VISUAL_TAIL_LINES,
  renderPreFrame,
  renderVerdictFrame,
  assertContains,
  assertNotContains,
  assertNonZeroExit,
  assertZeroExit
}
