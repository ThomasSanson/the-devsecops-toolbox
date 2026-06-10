/* global Given */
/**
 * Setup Givens for the guidance/auth VARIANT scenarios:
 *
 *   - gum-only install (glow missing fast-fail path)
 *   - gum+glow+glab install WITH a git remote (host detection / gitlabssh
 *     normalization paths — no test GitLab needed, the remote is fake)
 *
 * Reuses init-guidance.js' shared globals (freshUbuntuContainer,
 * lastCapturedOutput, lastCapturedExitCode) so its When/Then steps apply
 * unchanged.
 */
const {
  setupFreshUbuntuEnvironment,
  runInFreshUbuntu
} = require('../helpers/freshUbuntu')

const TOOL_INSTALL_TIMEOUT = 600000
const GUM_INSTALL = 'bash .config/gum/install.sh'
const GUM_GLOW_GLAB_INSTALL = 'bash .config/gum/install.sh && bash .config/glow/install.sh && task glab:install'

Given('the fresh Ubuntu environment has "gum" installed', () => {
  global.freshUbuntuContainer = setupFreshUbuntuEnvironment()
  const result = runInFreshUbuntu(global.freshUbuntuContainer, GUM_INSTALL, { timeout: TOOL_INSTALL_TIMEOUT })
  if (result.exitCode !== 0) {
    throw new Error(`gum install failed (exit ${result.exitCode}):\n${result.output}`)
  }
})

Given('the fresh Ubuntu environment has "gum", "glow" and "glab" installed with git remote {string}', (gitRemote) => {
  global.freshUbuntuContainer = setupFreshUbuntuEnvironment({ gitRemote })
  const result = runInFreshUbuntu(
    global.freshUbuntuContainer,
    GUM_GLOW_GLAB_INSTALL,
    { timeout: TOOL_INSTALL_TIMEOUT }
  )
  if (result.exitCode !== 0) {
    throw new Error(`gum/glow/glab install failed (exit ${result.exitCode}):\n${result.output}`)
  }
})
