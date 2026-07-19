/* global inject Before After Given When Then */
/**
 * init-guidance storyboard — `task devsecops:init` tells you exactly what to
 * fix when your GitLab wiring is not ready. ONE Gherkin sentence = ONE
 * storyboard card = ONE pixel baseline, asserted inside the step (tolerance: 0);
 * every verdict card twins its <pre> frame with a programmatic assert of the
 * same fact (captured stdout / exit code).
 *
 * This file (kept referenced by codecept.conf.js) replaces the former flat
 * guidance bindings: the whole init-guidance family — missing-auth,
 * disabled-success, non-gitlab-remote — now lives in
 * features/01-install/first-run-help.feature as one storyboard.
 * Setup reuses the fresh-Ubuntu plumbing (freshUbuntu.js); the deterministic
 * filters + <pre> verdict renderer live in helpers/capturedOutput.js, shared
 * with the glab-auth-ensure storyboards.
 */

const { I } = inject()
const fs = require('fs')
const path = require('path')
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
  assertNonZeroExit,
  assertZeroExit
} = require('../helpers/capturedOutput')

const RUN_TIMEOUT = 600000
const GITLAB_REMOTE = 'https://gitlab.com/example/bootstrap-guidance.git'
const GITHUB_REMOTE = 'https://github.com/acme/widgets.git'

// One fresh Ubuntu container per situation, all torn down after the scenario.
let containers = []

Before(() => {
  containers = []
})

After(() => {
  for (const name of containers) teardownFreshUbuntu(name)
  containers = []
})

function freshEnv (opts) {
  const name = setupFreshUbuntuEnvironment(opts)
  containers.push(name)
  return name
}

// Tears a container down as soon as its chapter is done, instead of leaving
// it idle until the scenario's shared After() — see the missing-auth verdict
// below for why. Also drops it from `containers` so After() does not retry
// `docker rm` on an already-removed name.
function retireContainer (container) {
  teardownFreshUbuntu(container)
  containers = containers.filter((name) => name !== container)
}

function runCaptured (container, command) {
  const result = runInFreshUbuntu(container, command, { timeout: RUN_TIMEOUT })
  // Full output as a debug artifact — CodeceptJS truncates assertion errors,
  // which makes long init runs undiagnosable from the report alone.
  const artifact = path.join(__dirname, '..', '..', '_output', 'captured', `${container}.log`)
  fs.mkdirSync(path.dirname(artifact), { recursive: true })
  fs.writeFileSync(artifact, result.output)
  return result
}

// The stage: a fresh project wired to a GitLab remote whose CLI was never
// authenticated. The card shows the remote itself (git remote -v).
storyboardStep(Given, "a developer's new project points at a GitLab remote the CLI never signed into", async () => {
  const container = freshEnv({ extraPackages: ['git', 'unzip'], gitRemote: GITLAB_REMOTE })
  const res = runCaptured(container, 'git remote -v')
  assertContains(res.output, 'gitlab.com')
  await renderPreFrame(I, 'remote-gitlab', res.output.trimEnd())
})

// Verdict 1 — missing auth: init runs the full setup then stops at the auth
// gate, naming the sign-in command. The card is the verdict tail.
// This is the heaviest step in the whole scenario — a fresh Ubuntu box
// installing python/docker/node/go from scratch before it ever reaches the
// auth check. Tearing the container down right after (instead of leaving it
// idle until the scenario's shared After()) frees that disk before the next
// two chapters spin their own fresh containers — CI runs two workers, and
// leaving finished containers alive was measured causing dpkg to fail with
// "No space left on device" when another disk-heavy scenario overlaps.
storyboardStep(Then, 'init stops and prints the exact GitLab sign-in command to run', async () => {
  const container = containers[containers.length - 1]
  const res = runCaptured(container, 'task devsecops:init')
  assertNonZeroExit(res.exitCode, res.output)
  assertContains(res.output, 'GitLab authentication required')
  assertContains(res.output, 'task glab:auth')
  assertNotContains(res.output, 'DevSecOps project initialization completed')
  await renderVerdictFrame(I, 'verdict-missing-auth', res.output)
  retireContainer(container)
})

// Verdict 2 — opt-out: with TASK_GLAB_ENABLED=false every glab task is a no-op,
// so init completes with no GitLab guidance at all. Fresh project (no remote).
storyboardStep(Then, 'init finishes cleanly once the GitLab integration is turned off', async () => {
  const container = freshEnv({ extraPackages: ['git', 'unzip'] })
  const res = runCaptured(container, 'TASK_GLAB_ENABLED=false task devsecops:init')
  assertZeroExit(res.exitCode, res.output)
  assertContains(res.output, 'DevSecOps project initialization completed')
  assertNotContains(res.output, 'glab auth login')
  await renderVerdictFrame(I, 'verdict-optout', res.output)
  retireContainer(container)
})

// The context shift: another project cloned from GitHub instead of GitLab.
storyboardStep(When, "another developer's project points at a GitHub remote instead", async () => {
  const container = freshEnv({ extraPackages: ['git', 'unzip'], gitRemote: GITHUB_REMOTE })
  const res = runCaptured(container, 'git remote -v')
  assertContains(res.output, 'github.com')
  await renderPreFrame(I, 'remote-github', res.output.trimEnd())
})

// Verdict 3 — non-GitLab remote: init detects the foreign host and stops with
// remote-alignment guidance rather than pushing anywhere.
storyboardStep(Then, 'init refuses the non-GitLab remote and shows how to fix it', async () => {
  const container = containers[containers.length - 1]
  const res = runCaptured(container, 'task devsecops:init')
  assertNonZeroExit(res.exitCode, res.output)
  assertContains(res.output, 'No GitLab repository remote was detected.')
  assertContains(res.output, 'Align your repository remote, then rerun:')
  await renderVerdictFrame(I, 'verdict-github', res.output)
  retireContainer(container)
})
