/* global inject Before After Given When Then */
/**
 * E2E scenarios for `task devsecops:init` guidance / opt-out paths.
 *
 *   - missing-auth: git remote points to a GitLab host the user never
 *     authenticated against → init must fail with actionable guidance.
 *   - disabled-success: TASK_GLAB_ENABLED=false → init must complete
 *     cleanly without producing GitLab-specific output.
 *
 * Both scenarios run a `task devsecops:init` invocation in a fresh
 * Ubuntu container (no ttyd round-trip) and assert against the captured
 * stdout/stderr — rendered as a <pre> block in the browser for visual
 * regression at tolerance:0.
 */

const { I } = inject()
const {
  setupFreshUbuntuEnvironment,
  runInFreshUbuntu,
  teardownFreshUbuntu
} = require('../helpers/freshUbuntu')

const RUN_TIMEOUT = 600000
// Keep the visual tail short — these scenarios produce a lot of apt/Go/glab
// install noise upstream of the deterministic ending. 10 lines capture the
// last meaningful phase markers (Lefthook install → setup complete → init
// completed OR error block) without remounting into upstream noise.
const VISUAL_TAIL_LINES = 10

// Scenario-local state — shared via `global` so sibling step files
// (e.g. glab-auth-ensure.js) can reuse the When/Then steps below
// without re-implementing setup/teardown. Each scenario's Before
// resets these to a clean slate; After tears down the container.

function stripAnsi (str) {
  return str
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07]*\x07/g, '')
}

// Lines whose content varies between runs (token expiry dates, IDs,
// task-runner header lines) must be filtered before rendering so the
// pixel-perfect baseline stays reproducible.
const OUTPUT_NOISE_PATTERNS = [
  /^\{"id":\d+/,
  /^🦊 Applying merge request settings/,
  /^task: \[/,
  /Creating new Project Access Token .*expires \d{4}-\d{2}-\d{2}/,
  // Go module downloads during `task lefthook:install` are emitted in parallel
  // → non-deterministic ordering. The "🎉 Lefthook:install phase completed"
  // line that follows is deterministic and sufficient as proof.
  /^go: /,
  // Lefthook iterates a Go map when emitting the synced hook list, so the
  // order ("(commit-msg, pre-commit)" vs "(pre-commit, commit-msg)") is
  // non-deterministic. The next "🎉 Lefthook:install phase completed
  // successfully" line is deterministic and sufficient proof.
  /^sync hooks: /,
  // apt-get setup output during `task dev:setup-environment` dominates the
  // pre-init tail with non-deterministic package install lines. The
  // deterministic phase markers (✅ Lefthook installed, 🎉 Development
  // environment setup completed, ✅ DevSecOps project initialization
  // completed) are sufficient proof.
  /^Setting up /,
  /^Unpacking /,
  /^Preparing to unpack /,
  /^Selecting previously /,
  /^Processing triggers /,
  /^\(Reading database /,
  // Go / glab / gum / glow installation lines (versions move at each run).
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

// Anchor the tail on a known marker so trailing setup noise cannot shift the
// visual window between runs. Falls back to the last `tail` lines if the
// marker is absent.
function tailFromMarker (lines, markers, tail) {
  const markerIdx = lines.reduce((last, line, idx) => {
    return markers.some(m => line.includes(m)) ? idx : last
  }, -1)
  if (markerIdx < 0) return lines.slice(Math.max(0, lines.length - tail))
  const end = markerIdx + 1
  return lines.slice(Math.max(0, end - tail), end)
}

const TAIL_MARKERS = [
  '✅ DevSecOps project initialization completed', // disabled-success
  'then rerun  task devsecops:init', //              missing-auth + glab-auth-ensure (both scenarios)
  'install     glab' //                              glab-auth-ensure-missing-bin gum box footer
]

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

Before(() => {
  global.freshUbuntuContainer = null
  global.lastCapturedOutput = ''
  global.lastCapturedExitCode = 0
})

After(() => {
  teardownFreshUbuntu(global.freshUbuntuContainer)
  global.freshUbuntuContainer = null
})

// ============================================
// GIVEN — environment setup
// ============================================

Given('a fresh Ubuntu environment with the toolbox is set up', () => {
  global.freshUbuntuContainer = setupFreshUbuntuEnvironment()
})

Given('a fresh Ubuntu environment with the toolbox is set up with git remote {string}', (gitRemote) => {
  global.freshUbuntuContainer = setupFreshUbuntuEnvironment({
    extraPackages: ['git', 'unzip'],
    gitRemote
  })
})

Given('a fresh Ubuntu environment with the toolbox is set up with packages {string}', (packages) => {
  global.freshUbuntuContainer = setupFreshUbuntuEnvironment({
    extraPackages: packages.split(/\s+/).filter(Boolean)
  })
})

// ============================================
// WHEN — run the command and capture output
// ============================================

When('I run the command {string} in the fresh Ubuntu environment', (command) => {
  if (!global.freshUbuntuContainer) {
    throw new Error('No fresh Ubuntu container has been set up for this scenario.')
  }
  const result = runInFreshUbuntu(global.freshUbuntuContainer, command, { timeout: RUN_TIMEOUT })
  global.lastCapturedOutput = result.output
  global.lastCapturedExitCode = result.exitCode
})

// ============================================
// THEN — assertions on captured output
// ============================================

Then('the captured output should contain {string}', (expected) => {
  const cleaned = stripAnsi(global.lastCapturedOutput)
  if (!cleaned.includes(expected)) {
    throw new Error(
      `Expected captured output to contain ${JSON.stringify(expected)}\n` +
      `---\n${cleaned}\n---`
    )
  }
})

Then('the captured output should not contain {string}', (forbidden) => {
  const cleaned = stripAnsi(global.lastCapturedOutput)
  if (cleaned.includes(forbidden)) {
    throw new Error(
      `Expected captured output NOT to contain ${JSON.stringify(forbidden)}\n` +
      `---\n${cleaned}\n---`
    )
  }
})

Then('the captured command should exit with code {int}', (expectedCode) => {
  if (global.lastCapturedExitCode !== expectedCode) {
    throw new Error(
      `Expected exit code ${expectedCode}, got ${global.lastCapturedExitCode}\n` +
      `--- captured output ---\n${global.lastCapturedOutput}\n---`
    )
  }
})

Then('the captured command should exit with a non-zero code', () => {
  if (global.lastCapturedExitCode === 0) {
    throw new Error(
      'Expected non-zero exit, got 0\n' +
      `--- captured output ---\n${global.lastCapturedOutput}\n---`
    )
  }
})

When('the captured output is displayed in the browser', async () => {
  const lines = filterOutput(global.lastCapturedOutput)
  const tail = tailFromMarker(lines, TAIL_MARKERS, VISUAL_TAIL_LINES)
  const output = tail.join('\n')

  await I.usePlaywrightTo('render captured output in browser', async ({ page }) => {
    await page.setContent(
      '<!DOCTYPE html><html><body style="background:#1e1e1e;margin:0;padding:16px">' +
      '<pre id="task-output" style="color:#d4d4d4;font-family:monospace;font-size:14px;line-height:1.4;white-space:pre-wrap;word-break:break-all">' +
      output.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
      '</pre></body></html>'
    )
  })
  await I.wait(0.5)
})

Then('the captured output should visually match {string}', async (baselineName) => {
  await I.takeScreenshot(baselineName)
  await I.assertVisualMatch(baselineName)
})
