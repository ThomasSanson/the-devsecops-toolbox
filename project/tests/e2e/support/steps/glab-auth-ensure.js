/* global inject Before After Given When */
/**
 * glab:auth:ensure storyboard (verdicts) — @first-run-help (chapter 1).
 * A single developer walks the auth check forward, installing one dependency
 * at a time; the check stops at the next missing piece and names its remedy.
 * ONE container, four verdicts in the order the check runs them (gum -> glow ->
 * glab -> sign-in). ONE Gherkin sentence = ONE card = ONE pixel baseline,
 * asserted inside the step (tolerance: 0); each verdict twins its <pre> frame
 * with a programmatic assert of the captured stdout / exit code.
 *
 * This file (kept referenced by codecept.conf.js) replaces the former flat
 * glab-auth-ensure bindings. Setup reuses freshUbuntu.js; the deterministic
 * filters + <pre> verdict renderer live in helpers/capturedOutput.js.
 */

const { I } = inject()
const {
  setupFreshUbuntuEnvironment,
  runInFreshUbuntu,
  teardownFreshUbuntu
} = require('../helpers/freshUbuntu')
const {
  storyboardStep
} = require('../../../../../.config/codeceptjs/storyboard')
const {
  renderPreFrame,
  renderVerdictFrame,
  assertContains,
  assertNonZeroExit
} = require('../helpers/capturedOutput')

const TOOL_INSTALL_TIMEOUT = 600000
const ENSURE_TIMEOUT = 300000

// `gum:`/`glow:` are not exposed via the root Taskfile (only the generated
// project's Taskfile picks them up via copier), so we invoke their install
// scripts directly. `glab` IS exposed, so `task glab:install` works.
const GUM_INSTALL = 'bash .config/gum/install.sh'
const GLOW_INSTALL = 'bash .config/glow/install.sh'
const GLAB_INSTALL = 'task glab:install'

let authContainer = null

Before(() => {
  authContainer = null
})

After(() => {
  teardownFreshUbuntu(authContainer)
  authContainer = null
})

function install (command) {
  const result = runInFreshUbuntu(authContainer, command, { timeout: TOOL_INSTALL_TIMEOUT })
  if (result.exitCode !== 0) {
    throw new Error(`install "${command}" failed (exit ${result.exitCode}):\n${result.output}`)
  }
}

function ensure (command = 'task glab:auth:ensure') {
  return runInFreshUbuntu(authContainer, command, { timeout: ENSURE_TIMEOUT })
}

// The stage: a fresh checkout with none of the premium UI tools on PATH.
storyboardStep(Given, 'a fresh toolbox checkout with none of its UI tools installed yet', async () => {
  authContainer = setupFreshUbuntuEnvironment()
  const res = runInFreshUbuntu(
    authContainer,
    'for t in gum glow glab; do command -v "$t" >/dev/null 2>&1 && echo "$t: $(command -v "$t")" || echo "$t: not installed"; done',
    { timeout: 60000 }
  )
  assertContains(res.output, 'gum: not installed')
  await renderPreFrame(I, 'tools-absent', res.output.trimEnd())
})

// Verdict 1 — gum missing: the check stops at the very first dependency.
storyboardStep(When, 'the developer runs the auth check straight away', async () => {
  const res = ensure()
  assertNonZeroExit(res.exitCode, res.output)
  assertContains(res.output, 'Required UI dependency missing: gum')
  assertContains(res.output, 'task dev:setup-environment')
  await renderVerdictFrame(I, 'verdict-missing-gum', res.output)
})

// Verdict 2 — glow missing: gum in place, the check advances to the next tool.
storyboardStep(When, 'the developer installs gum and re-runs the check', async () => {
  install(GUM_INSTALL)
  const res = ensure()
  assertNonZeroExit(res.exitCode, res.output)
  assertContains(res.output, 'Required UI dependency missing: glow')
  assertContains(res.output, 'task dev:setup-environment')
  await renderVerdictFrame(I, 'verdict-missing-glow', res.output)
})

// Verdict 3 — CLI missing: both UI tools in place, only glab is absent.
storyboardStep(When, 'the developer adds glow and re-runs, leaving only the CLI missing', async () => {
  install(GLOW_INSTALL)
  const res = ensure()
  assertNonZeroExit(res.exitCode, res.output)
  assertContains(res.output, 'install     glab')
  await renderVerdictFrame(I, 'verdict-missing-glab', res.output)
})

// Verdict 4 — not signed in: everything installed, CI mode forces the
// non-interactive branch that names the sign-in command.
storyboardStep(When, 'the developer installs the CLI and re-runs it in CI mode, still not signed in', async () => {
  install(GLAB_INSTALL)
  const res = ensure('CI=true task glab:auth:ensure')
  assertNonZeroExit(res.exitCode, res.output)
  assertContains(res.output, 'GitLab authentication required')
  assertContains(res.output, 'task glab:auth')
  await renderVerdictFrame(I, 'verdict-ci-not-authed', res.output)
})
