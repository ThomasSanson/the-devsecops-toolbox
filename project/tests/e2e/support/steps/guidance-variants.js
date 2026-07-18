/* global inject Before After Given When Then */
/**
 * glab:auth:ensure storyboard (host detection) — @first-run-help (chapter 2).
 * The check reads the GitLab host straight from the git remote, and normalizes
 * an SSH-style gitlabssh.* remote back to its gitlab.* API host. ONE container
 * with the CLIs installed; the remote is re-pointed between the two verdicts.
 * ONE Gherkin sentence = ONE card = ONE pixel baseline, asserted inside the
 * step (tolerance: 0); each verdict twins its <pre> frame with a programmatic
 * assert of the captured stdout.
 *
 * This file (kept referenced by codecept.conf.js) replaces the former flat
 * host-detection bindings. Setup reuses freshUbuntu.js; the deterministic
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
  assertNotContains,
  assertNonZeroExit
} = require('../helpers/capturedOutput')

const TOOL_INSTALL_TIMEOUT = 600000
const ENSURE_TIMEOUT = 300000
const GUM_GLOW_GLAB_INSTALL =
  'bash .config/gum/install.sh && bash .config/glow/install.sh && task glab:install'
const SELF_HOSTED_REMOTE = 'https://gitlab.selfhosted-corp.example/acme/widgets.git'
const GITLABSSH_REMOTE = 'git@gitlabssh.selfhosted-corp.example:acme/widgets.git'
const EXPECTED_HOST = 'host        gitlab.selfhosted-corp.example'

let hostContainer = null

Before(() => {
  hostContainer = null
})

After(() => {
  teardownFreshUbuntu(hostContainer)
  hostContainer = null
})

function runIn (command, timeout = ENSURE_TIMEOUT) {
  return runInFreshUbuntu(hostContainer, command, { timeout })
}

// The stage: a self-hosted GitLab project with the CLIs installed but no
// sign-in yet. The card shows the self-hosted remote.
storyboardStep(Given, 'a self-hosted GitLab project with the tools installed but no sign-in yet', async () => {
  hostContainer = setupFreshUbuntuEnvironment({ gitRemote: SELF_HOSTED_REMOTE })
  const installed = runIn(GUM_GLOW_GLAB_INSTALL, TOOL_INSTALL_TIMEOUT)
  if (installed.exitCode !== 0) {
    throw new Error(`gum/glow/glab install failed (exit ${installed.exitCode}):\n${installed.output}`)
  }
  const res = runIn('git remote -v', 60000)
  assertContains(res.output, 'gitlab.selfhosted-corp.example')
  await renderPreFrame(I, 'remote-selfhosted', res.output.trimEnd())
})

// Verdict 1 — host read from the remote: CI mode names the detected host.
storyboardStep(Then, 'the check reads the self-hosted GitLab host straight from the remote', async () => {
  const res = runIn('CI=true task glab:auth:ensure')
  assertNonZeroExit(res.exitCode, res.output)
  assertContains(res.output, 'GitLab authentication required')
  assertContains(res.output, EXPECTED_HOST)
  await renderVerdictFrame(I, 'verdict-selfhosted-host', res.output)
})

// The remote re-point: an SSH-style gitlabssh.* URL for the same project.
storyboardStep(When, 'the same project instead uses an SSH-style gitlabssh remote', async () => {
  const repoint = runIn(`git remote set-url origin ${GITLABSSH_REMOTE}`, 60000)
  if (repoint.exitCode !== 0) {
    throw new Error(`git remote set-url failed (exit ${repoint.exitCode}):\n${repoint.output}`)
  }
  const res = runIn('git remote -v', 60000)
  assertContains(res.output, 'gitlabssh.selfhosted-corp.example')
  await renderPreFrame(I, 'remote-gitlabssh', res.output.trimEnd())
})

// Verdict 2 — normalized host: gitlabssh.* is rewritten to the gitlab.* API host.
storyboardStep(Then, 'the check turns it back into the gitlab API host', async () => {
  const res = runIn('CI=true task glab:auth:ensure')
  assertNonZeroExit(res.exitCode, res.output)
  assertContains(res.output, EXPECTED_HOST)
  assertNotContains(res.output, 'gitlabssh')
  await renderVerdictFrame(I, 'verdict-gitlabssh-normalized', res.output)
})
