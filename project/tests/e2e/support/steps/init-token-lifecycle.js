/* global inject Before After */
/**
 * Token-healing storyboard — `task devsecops:init` self-heals its GitLab
 * plumbing. ONE Gherkin sentence = ONE storyboard card = ONE pixel baseline,
 * asserted inside the step (tolerance: 0); each Then twins its page/terminal
 * frame with a programmatic REST assert of the SAME fact.
 *
 * This file (kept referenced by codecept.conf.js) replaces the former flat
 * token-lifecycle bindings: the whole init/token family — baseline, revoked,
 * resync, renovate-clone, idempotency, tampered, duplicate — now lives in
 * features/03-daily-work/token-healing.feature as two storyboards.
 * Setup reuses the same plumbing as init-baseline.js (workspaceRepo bootstrap +
 * captured init output rendered to a <pre>), and the GitLab pages are the masked
 * page-object captures.
 */

const { execSync } = require('child_process')
const { I, GitLabAccessTokenPage, GitLabUserPage, GitLabProjectPage } = inject()
const {
  BASE_URL,
  projectPath,
  getRootHeaders,
  createLambdaPersonalAccessToken,
  revokePersonalAccessToken,
  listProjectAccessTokens,
  createProjectAccessToken,
  revokeProjectAccessToken,
  readProjectVariable,
  updateProjectVariable
} = require('../helpers/gitlabApi')
const { bootstrapWorkspaceRepo, runTaskInRepoCaptured } = require('../helpers/workspaceRepo')
const { filterTaskOutput, tailFromMarker } = require('../helpers/initOutput')
const { renderPreFrame } = require('../helpers/capturedOutput')
const {
  storyboardStep,
  addStoryboardFrame,
  capturePageFrame
} = require('../../../../../.config/codeceptjs/storyboard')

const TOKEN = 'TASK_COMMITIZEN_TOKEN'
const RENOVATE_TOKEN = 'TASK_RENOVATE_TOKEN'
const COMPLETION_MARKER = '✅ DevSecOps project initialization completed'
const TAMPERED_VALUE = 'tampered-by-e2e'

// Per-scenario state (one project per scenario, run sequentially).
let projectName = null
let glabToken = null
let glabTokenId = null
let capturedTokenId = null

function repoDirFor (name) {
  return `/tmp/${name}-repo`
}

Before(() => {
  projectName = null
  glabToken = null
  glabTokenId = null
  capturedTokenId = null
})

After(async () => {
  // Best-effort: drop the throwaway working tree + clone dir and revoke the
  // per-scenario glab PAT so credentials do not pile up on the test volume.
  if (projectName) {
    try { execSync(`rm -rf ${repoDirFor(projectName)} /tmp/${projectName}-clone`, { stdio: 'ignore' }) } catch (_) {}
  }
  if (glabTokenId) {
    try { await revokePersonalAccessToken(glabTokenId, await getRootHeaders()) } catch (_) {}
    glabTokenId = null
  }
})

// ---------------------------------------------------------------------------
// Setup + REST helpers (reuse the init-baseline plumbing).
// ---------------------------------------------------------------------------

async function ensureLambdaUser () {
  await GitLabUserPage.ensureUserViaApi(
    BASE_URL,
    process.env.TASK_GITLAB_ROOT_USER,
    process.env.TASK_GITLAB_ROOT_PASSWORD,
    {
      email: process.env.TASK_GITLAB_LAMBDA_EMAIL,
      username: process.env.TASK_GITLAB_LAMBDA_USER,
      name: 'Lambda User',
      password: process.env.TASK_GITLAB_LAMBDA_PASSWORD
    }
  )
}

// Ensure the lambda user, a fresh project, and the first `task devsecops:init`
// that provisions the token + CI/CD variable + branch protection (run through
// bootstrapWorkspaceRepo, which also sets up the dev toolchain + glab auth).
async function provisionInitialisedProject (name) {
  projectName = name
  await ensureLambdaUser()

  await GitLabProjectPage.deleteProjectIfExists(
    BASE_URL,
    process.env.TASK_GITLAB_ROOT_USER,
    process.env.TASK_GITLAB_ROOT_PASSWORD,
    projectPath(name)
  )
  await GitLabUserPage.loginAs(process.env.TASK_GITLAB_LAMBDA_USER, process.env.TASK_GITLAB_LAMBDA_PASSWORD)
  await GitLabProjectPage.createBlankPublicProject(name)

  const rootHeaders = await getRootHeaders()
  const minted = await createLambdaPersonalAccessToken(
    `glab-cli-token-for-${name}`, ['api', 'write_repository'], rootHeaders
  )
  glabToken = minted.token
  glabTokenId = minted.id

  // runInit:true runs `task devsecops:init` at the end of the bootstrap; its
  // output is not needed here (the Given card is the GitLab access-tokens page).
  bootstrapWorkspaceRepo(name, repoDirFor(name), glabToken, { runInit: true, timeout: 600000 })
}

// Re-run init with captured stdout so the healing verdict can be rendered.
function reRunInitCaptured () {
  let result = runTaskInRepoCaptured('task devsecops:init', repoDirFor(projectName), glabToken, { timeout: 300000 })
  if (result.exitCode === 201) {
    result = runTaskInRepoCaptured('task devsecops:init', repoDirFor(projectName), glabToken, { timeout: 300000 })
  }
  global.lastTaskOutput = result.output
  if (result.exitCode !== 0) {
    throw new Error(`task devsecops:init re-run failed (exit ${result.exitCode}):\n${result.output}`)
  }
}

async function activeTokens (name) {
  const tokens = await listProjectAccessTokens(name, await getRootHeaders())
  return (tokens.data || []).filter(t => t.name === TOKEN && t.active && !t.revoked)
}

async function singleActiveToken (name) {
  const active = await activeTokens(name)
  if (active.length !== 1) {
    throw new Error(`Expected exactly 1 active token "${TOKEN}" for ${name}, found ${active.length}`)
  }
  return active[0]
}

// A real authenticated clone using the CI/CD variable's token value — the
// programmatic twin of the clone card (this is renovate-token-clone's assert).
async function assertCloneWithVariable (variableName) {
  const variable = await readProjectVariable(projectName, variableName, await getRootHeaders())
  const tokenValue = variable.data && variable.data.value
  if (!tokenValue) throw new Error(`CI/CD variable "${variableName}" is empty for ${projectName}`)
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const cloneDir = `/tmp/${projectName}-clone`
  try {
    execSync(
      `rm -rf ${cloneDir} && git clone http://${lambdaUser}:${tokenValue}@gitlab/${lambdaUser}/${projectName}.git ${cloneDir}`,
      { stdio: 'pipe', timeout: 120000 }
    )
  } catch (error) {
    const stderr = error.stderr ? error.stderr.toString() : ''
    throw new Error(`git clone using "${variableName}" failed:\n${stderr}`)
  }
}

// ---------------------------------------------------------------------------
// Frame helpers.
// ---------------------------------------------------------------------------

// Capture a masked GitLab page at the storyboard aspect (1024x640) as a frame.
async function pageFrame (navigate, frameName) {
  I.resizeWindow(1024, 640)
  await navigate()
  await addStoryboardFrame(I, await capturePageFrame(I, frameName))
  I.resizeWindow(1024, 768)
}

const gotoAccessTokens = () => GitLabAccessTokenPage.gotoAccessTokensAndMask(projectPath(projectName))
const gotoCiCdVariables = () => GitLabAccessTokenPage.gotoCiCdAndMask(projectPath(projectName))

// The healing verdict: the last deterministic lines of the captured init run.
async function initVerdictFrame (frameName) {
  const lines = filterTaskOutput(global.lastTaskOutput || '')
  await renderPreFrame(I, frameName, tailFromMarker(lines, COMPLETION_MARKER, 30).join('\n'))
}

// The clone proof: a real `git ls-remote` over HTTPS with the healed token —
// the token authenticates or the command fails. Volatile SHAs and the secret
// token are masked so the frame stays pixel-stable; the fuller clone runs in
// the programmatic twin (assertCloneWithVariable).
async function cloneProofFrame (frameName, variableName) {
  const variable = await readProjectVariable(projectName, variableName, await getRootHeaders())
  const tokenValue = variable.data && variable.data.value
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const realUrl = `http://${lambdaUser}:${tokenValue}@gitlab/${lambdaUser}/${projectName}.git`
  let out
  try {
    out = execSync(`git ls-remote ${realUrl}`, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, encoding: 'utf8' })
  } catch (error) {
    throw new Error(`git ls-remote using "${variableName}" failed:\n${error.stderr || error.message}`)
  }
  const maskedOut = out.replace(/^[0-9a-f]{40}\t/gm, '<sha>\t').replace(/\r/g, '').trimEnd()
  const shown =
    `$ git ls-remote http://<lambda-user>:<token>@gitlab/<lambda-user>/${projectName}.git\n` +
    (maskedOut || '(authenticated — remote reachable)')
  await renderPreFrame(I, frameName, shown)
}

// ===========================================================================
// MAIN storyboard — @e2e-token-healing-journey. A revoked token is
// re-provisioned, the variable re-synced, the healed token clones, and a
// second run is a no-op.
// ===========================================================================

storyboardStep(Given, 'a project the framework has already set up with its automation token', {
  note: 'A fresh project after its first `task devsecops:init`: the access-tokens page shows the automation token init created. Off-camera: the lambda user, the fresh project, the setup that ran init once. Dates that change every run are masked.',
  copy: 'http://gitlab/<lambda-user>/<project>/-/settings/access_tokens'
}, async () => {
  await provisionInitialisedProject('e2e-token-healing')
  capturedTokenId = (await singleActiveToken(projectName)).id
  await pageFrame(gotoAccessTokens, 'tokens-provisioned')
})

storyboardStep(When, "the developer revokes the automation token behind the framework's back", {
  note: 'The token is revoked from outside the framework (as if someone deleted it in GitLab): the access-tokens page no longer lists the automation token. The test also checks through the API that no automation token is active anymore.',
  copy: 'http://gitlab/<lambda-user>/<project>/-/settings/access_tokens'
}, async () => {
  const token = await singleActiveToken(projectName)
  const res = await revokeProjectAccessToken(projectName, token.id, await getRootHeaders())
  if (res.status >= 400) throw new Error(`Failed to revoke token ${token.id} (${res.status})`)
  await pageFrame(gotoAccessTokens, 'tokens-revoked')
  if ((await activeTokens(projectName)).length !== 0) {
    throw new Error('Expected no active Commitizen token after external revocation')
  }
})

storyboardStep(When, "the developer runs the framework's init again", {
  note: 'A single `task devsecops:init` re-run: the finishing message shows it noticed the token was missing and created a new one. The test also checks the command succeeded.',
  copy: 'task devsecops:init'
}, async () => {
  reRunInitCaptured()
  await initVerdictFrame('init-verdict-heal')
})

storyboardStep(Then, 'init has created a brand-new automation token', {
  note: 'The access-tokens page shows the automation token again. The test also checks through the API that exactly one is active and it is not the same token as before.',
  copy: 'http://gitlab/<lambda-user>/<project>/-/settings/access_tokens'
}, async () => {
  const token = await singleActiveToken(projectName)
  if (token.id === capturedTokenId) {
    throw new Error(`Token id was NOT rotated by the heal — still ${token.id}`)
  }
  capturedTokenId = token.id
  await pageFrame(gotoAccessTokens, 'tokens-healed')
})

storyboardStep(Then, 'init has updated the CI/CD variable to match the new token', {
  note: 'The CI/CD variables page shows the variable again, now pointing at the new token. The test also checks through the API that the variable exists and has a value.',
  copy: 'http://gitlab/<lambda-user>/<project>/-/settings/ci_cd'
}, async () => {
  const variable = await readProjectVariable(projectName, TOKEN, await getRootHeaders())
  if (!variable.data || !variable.data.value) {
    throw new Error(`CI/CD variable "${TOKEN}" is missing or empty after heal`)
  }
  await pageFrame(gotoCiCdVariables, 'variable-resynced')
})

storyboardStep(Then, 'the healed token clones the repository over HTTPS', {
  note: 'The healed token signs in to GitLab and lists the repository over HTTPS (the secret and commit IDs are masked). The test also does a full clone with both the automation token and the Renovate token, to prove they both actually work.',
  copy: 'git clone http://<lambda-user>:<token>@gitlab/<lambda-user>/<project>.git'
}, async () => {
  await cloneProofFrame('clone-healed', TOKEN)
  await assertCloneWithVariable(TOKEN)
  await assertCloneWithVariable(RENOVATE_TOKEN)
})

storyboardStep(When, 'the developer runs init a second time', {
  note: 'A second `task devsecops:init` on the already-healed project: the finishing message reports the token is already in place, nothing to recreate. The test also checks the command succeeded.',
  copy: 'task devsecops:init'
}, async () => {
  reRunInitCaptured()
  await initVerdictFrame('init-verdict-idempotent')
})

storyboardStep(Then, 'the second run leaves the healed token untouched', {
  note: 'The access-tokens page has not changed: still one automation token. The test also checks through the API that it is the exact same token as before — init does not quietly replace it on every run.',
  copy: 'http://gitlab/<lambda-user>/<project>/-/settings/access_tokens'
}, async () => {
  const token = await singleActiveToken(projectName)
  if (token.id !== capturedTokenId) {
    throw new Error(`Idempotency broken: token id changed from ${capturedTokenId} to ${token.id}`)
  }
  await pageFrame(gotoAccessTokens, 'tokens-idempotent')
})

// ===========================================================================
// VARIANT storyboard — @e2e-token-healing-variants. The other two break modes:
// a tampered pipeline variable is repaired, and duplicate tokens are purged.
// ===========================================================================

storyboardStep(Given, 'a project the framework already set up and is healthy', {
  note: 'A fresh project after its first `task devsecops:init`, working correctly: one automation token on the access-tokens page. Off-camera: the lambda user, the fresh project, the setup that ran init once.',
  copy: 'http://gitlab/<lambda-user>/<project>/-/settings/access_tokens'
}, async () => {
  await provisionInitialisedProject('e2e-token-healing-variants')
  await singleActiveToken(projectName)
  await pageFrame(gotoAccessTokens, 'variant-healthy')
})

storyboardStep(When, "a duplicate automation token is planted behind the framework's back", {
  note: 'A second token with the same name is created from outside the framework: the access-tokens page now lists two automation tokens where there should be one. The test also checks through the API that two are active.',
  copy: 'http://gitlab/<lambda-user>/<project>/-/settings/access_tokens'
}, async () => {
  const expiresAt = new Date(Date.now() + 300 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const res = await createProjectAccessToken(projectName, {
    name: TOKEN, scopes: ['api', 'write_repository'], access_level: 40, expires_at: expiresAt
  }, await getRootHeaders())
  if (res.status >= 400) throw new Error(`Failed to plant duplicate token (${res.status}): ${JSON.stringify(res.data)}`)
  await pageFrame(gotoAccessTokens, 'variant-duplicate')
  if ((await activeTokens(projectName)).length !== 2) {
    throw new Error('Expected two active Commitizen tokens after planting the duplicate')
  }
})

storyboardStep(When, 'the CI/CD variable is overwritten with a bad value', {
  note: 'The CI/CD variable is tampered with (its value replaced by a bad string, hidden on screen by GitLab\'s own masking): the CI/CD variables page still lists it. The test also checks through the API that its value is now the bad one.',
  copy: 'http://gitlab/<lambda-user>/<project>/-/settings/ci_cd'
}, async () => {
  const res = await updateProjectVariable(projectName, TOKEN, { value: TAMPERED_VALUE }, await getRootHeaders())
  if (res.status >= 400) throw new Error(`Failed to tamper variable (${res.status}): ${JSON.stringify(res.data)}`)
  await pageFrame(gotoCiCdVariables, 'variant-tampered')
  const variable = await readProjectVariable(projectName, TOKEN, await getRootHeaders())
  if (!variable.data || variable.data.value !== TAMPERED_VALUE) {
    throw new Error('Expected the pipeline variable to carry the tampered value')
  }
})

storyboardStep(When, "the developer runs the framework's init once more", {
  note: 'A single `task devsecops:init` re-run: the finishing message shows it removed the duplicate token and put the CI/CD variable back. The test also checks the command succeeded.',
  copy: 'task devsecops:init'
}, async () => {
  reRunInitCaptured()
  await initVerdictFrame('variant-init-verdict')
})

storyboardStep(Then, 'only one automation token survives the purge', {
  note: 'The access-tokens page is back to a single automation token — the duplicate is gone. The test also checks through the API that exactly one is active.',
  copy: 'http://gitlab/<lambda-user>/<project>/-/settings/access_tokens'
}, async () => {
  await singleActiveToken(projectName)
  await pageFrame(gotoAccessTokens, 'variant-purged')
})

storyboardStep(Then, 'the healed CI/CD variable clones the repository again', {
  note: 'The variable no longer carries the bad value: it signs in to GitLab again and lists the repository (the secret and commit IDs are masked). The test also checks through the API that the value is no longer the tampered one, and does a full clone with it.',
  copy: 'git clone http://<lambda-user>:<token>@gitlab/<lambda-user>/<project>.git'
}, async () => {
  const variable = await readProjectVariable(projectName, TOKEN, await getRootHeaders())
  if (!variable.data || variable.data.value === TAMPERED_VALUE) {
    throw new Error('Expected the pipeline variable to be healed away from the tampered value')
  }
  await cloneProofFrame('variant-clone-healed', TOKEN)
  await assertCloneWithVariable(TOKEN)
})
