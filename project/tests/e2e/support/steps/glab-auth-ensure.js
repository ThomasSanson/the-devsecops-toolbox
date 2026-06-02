/* global Given */
/**
 * E2E scenarios for `task glab:auth:ensure` — covers two distinct UX paths:
 *
 *   - missing-binary: gum + glow are present but glab is NOT installed →
 *     ensure must fail and tell the user how to install glab.
 *   - ci-mode: all CLIs present but no GitLab auth → CI=true forces the
 *     non-interactive branch which must point users at the right task.
 *
 * The premium-UI live-prompt variant from the legacy bootstrap suite is
 * intentionally dropped: capturing a TUI animation mid-stream is racy by
 * design (acknowledged in the audit) and the missing-bin + CI-mode pair
 * already covers the substantive UX.
 *
 * Reuses init-guidance.js' shared globals (`global.freshUbuntuContainer`,
 * `global.lastCapturedOutput`, `global.lastCapturedExitCode`) so the
 * existing When/Then steps apply unchanged.
 */
const {
  setupFreshUbuntuEnvironment,
  runInFreshUbuntu
} = require('../helpers/freshUbuntu')

const TOOL_INSTALL_TIMEOUT = 600000

// `gum:` and `glow:` are not exposed via the root Taskfile (only the
// generated project's Taskfile picks them up via copier), so we invoke
// the install scripts directly. `glab` IS exposed (Taskfile root
// includes `glab:`), so `task glab:install` works.
const GUM_GLOW_INSTALL = 'bash .config/gum/install.sh && bash .config/glow/install.sh'
const GLAB_INSTALL = 'task glab:install'

Given('the fresh Ubuntu environment has "gum" and "glow" installed', () => {
  global.freshUbuntuContainer = setupFreshUbuntuEnvironment()
  const result = runInFreshUbuntu(
    global.freshUbuntuContainer,
    GUM_GLOW_INSTALL,
    { timeout: TOOL_INSTALL_TIMEOUT }
  )
  if (result.exitCode !== 0) {
    throw new Error(`gum/glow install failed (exit ${result.exitCode}):\n${result.output}`)
  }
})

Given('the fresh Ubuntu environment has "gum", "glow" and "glab" installed', () => {
  global.freshUbuntuContainer = setupFreshUbuntuEnvironment()
  const result = runInFreshUbuntu(
    global.freshUbuntuContainer,
    `${GUM_GLOW_INSTALL} && ${GLAB_INSTALL}`,
    { timeout: TOOL_INSTALL_TIMEOUT }
  )
  if (result.exitCode !== 0) {
    throw new Error(`gum/glow/glab install failed (exit ${result.exitCode}):\n${result.output}`)
  }
})
