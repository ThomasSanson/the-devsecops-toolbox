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
 * features/02-first-init/init-guidance.feature as one storyboard.
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
storyboardStep(Given, "a developer's new project points at a GitLab remote the CLI never signed into", {
  note: 'A throwaway project whose only link to GitLab is a remote the CLI never signed into. Set up off-camera: a fresh Ubuntu box with the toolbox and this git remote.',
  copy: 'git remote -v'
}, async () => {
  const container = freshEnv({ extraPackages: ['git', 'unzip'], gitRemote: GITLAB_REMOTE })
  const res = runCaptured(container, 'git remote -v')
  assertContains(res.output, 'gitlab.com')
  await renderPreFrame(I, 'remote-gitlab', res.output.trimEnd())
})

// Verdict 1 — missing auth: init runs the full setup then stops at the auth
// gate, naming the sign-in command. The card is the verdict tail.
storyboardStep(Then, 'running init stops and shows the exact GitLab sign-in command to run', {
  note: 'init installs its tools, reaches the sign-in check and stops with "GitLab authentication required", pointing at task glab:auth. The test also checks the command failed and printed that line.',
  copy: 'task devsecops:init'
}, async () => {
  const container = containers[containers.length - 1]
  const res = runCaptured(container, 'task devsecops:init')
  assertNonZeroExit(res.exitCode, res.output)
  assertContains(res.output, 'GitLab authentication required')
  assertContains(res.output, 'task glab:auth')
  assertNotContains(res.output, 'DevSecOps project initialization completed')
  await renderVerdictFrame(I, 'verdict-missing-auth', res.output)
})

// Verdict 2 — opt-out: with TASK_GLAB_ENABLED=false every glab task is a no-op,
// so init completes with no GitLab guidance at all. Fresh project (no remote).
storyboardStep(Then, 'turning the GitLab integration off lets init finish cleanly', {
  note: 'TASK_GLAB_ENABLED=false makes every glab step skip, so init reaches "DevSecOps project initialization completed" and never asks about sign-in. The test also checks the command succeeded and never printed "glab auth login".',
  copy: 'TASK_GLAB_ENABLED=false task devsecops:init'
}, async () => {
  const container = freshEnv({ extraPackages: ['git', 'unzip'] })
  const res = runCaptured(container, 'TASK_GLAB_ENABLED=false task devsecops:init')
  assertZeroExit(res.exitCode, res.output)
  assertContains(res.output, 'DevSecOps project initialization completed')
  assertNotContains(res.output, 'glab auth login')
  await renderVerdictFrame(I, 'verdict-optout', res.output)
})

// The context shift: another project cloned from GitHub instead of GitLab.
storyboardStep(When, "another developer's project points at a GitHub remote instead", {
  note: 'A new project whose remote points at github.com — a non-GitLab host init must never push to. The card shows the remote.',
  copy: 'git remote -v'
}, async () => {
  const container = freshEnv({ extraPackages: ['git', 'unzip'], gitRemote: GITHUB_REMOTE })
  const res = runCaptured(container, 'git remote -v')
  assertContains(res.output, 'github.com')
  await renderPreFrame(I, 'remote-github', res.output.trimEnd())
})

// Verdict 3 — non-GitLab remote: init detects the foreign host and stops with
// remote-alignment guidance rather than pushing anywhere.
storyboardStep(Then, 'init refuses the non-GitLab remote and shows how to fix it', {
  note: 'init finds no GitLab remote and stops with "No GitLab repository remote was detected.", giving the exact git remote set-url line to fix it. The test also checks the command failed and printed those lines.',
  copy: 'task devsecops:init'
}, async () => {
  const container = containers[containers.length - 1]
  const res = runCaptured(container, 'task devsecops:init')
  assertNonZeroExit(res.exitCode, res.output)
  assertContains(res.output, 'No GitLab repository remote was detected.')
  assertContains(res.output, 'Align your repository remote, then rerun:')
  await renderVerdictFrame(I, 'verdict-github', res.output)
})
