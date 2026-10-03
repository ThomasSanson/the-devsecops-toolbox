/* global inject Before After Given When Then */
/**
 * Token-healing storyboard — `task devsecops:init` self-heals its GitLab
 * plumbing. ONE Gherkin sentence = ONE storyboard card = ONE pixel baseline,
 * asserted inside the step (tolerance: 0); each Then twins its page/terminal
 * frame with a programmatic REST assert of the SAME fact.
 *
 * This file (kept referenced by codecept.conf.js) replaces the former flat
 * token-lifecycle bindings: the whole init/token family — baseline, revoked,
 * resync, renovate-clone, idempotency, tampered, duplicate — now lives in
 * features/02-daily-work/self-healing.feature as one storyboard.
 * Setup reuses the same plumbing as init-baseline.js (workspaceRepo bootstrap +
 * captured init output rendered to a <pre>), and the GitLab pages are the masked
 * page-object captures.
 */

const fs = require('fs')
const { execSync } = require('child_process')
const { I, GitLabAccessTokenPage, GitLabUserPage, GitLabProjectPage, GitLabSettingsPage } = inject()
const {
  BASE_URL,
  projectPath,
  encodedProjectPath,
  getRootHeaders,
  createProject,
  createLambdaPersonalAccessToken,
  revokePersonalAccessToken,
  listProjectAccessTokens,
  createProjectAccessToken,
  revokeProjectAccessToken,
  readProjectVariable,
  updateProjectVariable
} = require('../helpers/gitlabApi')
const { bootstrapWorkspaceRepo, runTaskInRepoCaptured } = require('../helpers/workspaceRepo')
const { freshGet, freshPost, freshDelete } = require('../helpers/http')
const { prepareVersionedTemplate, renderProjectFromTemplate } = require('../helpers/copierRender')
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
const RELOAD_MARKER = '♻️ Framework reloaded'
const TAMPERED_VALUE = 'tampered-by-e2e'

// Per-scenario state (one project per scenario, run sequentially).
let projectName = null
let glabToken = null
let glabTokenId = null
let capturedTokenId = null
let reloadTemplate = null
let tokenIdsBeforeReload = null

function repoDirFor (name) {
  return `/tmp/${name}-repo`
}

Before(() => {
  projectName = null
  glabToken = null
  glabTokenId = null
  capturedTokenId = null
  tokenIdsBeforeReload = null
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
  // The versioned template the reload chapter renders from (see below).
  if (reloadTemplate) {
    try { execSync(`rm -rf ${reloadTemplate}`, { stdio: 'ignore' }) } catch (_) {}
    reloadTemplate = null
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
// skipLogin: the two chapters of the @self-healing storyboard run in ONE
// scenario, so the browser session established by chapter 1 is still signed in
// when chapter 2 provisions its own project. GitLab redirects an already
// authenticated session away from /users/sign_in, so a second loginAs would
// hang waiting for the #user_login form that never appears — chapter 2 reuses
// the live session instead.
async function provisionInitialisedProject (name, { skipLogin = false } = {}) {
  projectName = name
  await ensureLambdaUser()

  await GitLabProjectPage.deleteProjectIfExists(
    BASE_URL,
    process.env.TASK_GITLAB_ROOT_USER,
    process.env.TASK_GITLAB_ROOT_PASSWORD,
    projectPath(name)
  )
  if (!skipLogin) {
    await GitLabUserPage.loginAs(process.env.TASK_GITLAB_LAMBDA_USER, process.env.TASK_GITLAB_LAMBDA_PASSWORD)
  }
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
      `rm -rf ${cloneDir} && git clone http://${lambdaUser}:${tokenValue}@gitlab/${lambdaUser}/${projectName}.git ${cloneDir}`, // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
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
// `height` grabs a taller viewport when the page has more to prove than fits at
// 640 — the revoked tokens a reload leaves behind, for instance.
async function pageFrame (navigate, frameName, { height = 640 } = {}) {
  I.resizeWindow(1024, height)
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
  const realUrl = `http://${lambdaUser}:${tokenValue}@gitlab/${lambdaUser}/${projectName}.git` // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
  let out
  try {
    out = execSync(`git ls-remote ${realUrl}`, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, encoding: 'utf8' })
  } catch (error) {
    throw new Error(`git ls-remote using "${variableName}" failed:\n${error.stderr || error.message}`)
  }
  const maskedOut = out.replace(/^[0-9a-f]{40}\t/gm, '<sha>\t').replace(/\r/g, '').trimEnd()
  const shown =
    `$ git ls-remote http://<lambda-user>:<token>@gitlab/<lambda-user>/${projectName}.git\n` + // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
    (maskedOut || '(authenticated — remote reachable)')
  await renderPreFrame(I, frameName, shown)
}

// ===========================================================================
// MAIN storyboard — @self-healing (chapter 1). A revoked token is
// re-provisioned, the variable re-synced, the healed token clones, and a
// second run is a no-op.
// ===========================================================================

storyboardStep(Given, 'a project the framework has already set up with its automation token', async () => {
  await provisionInitialisedProject('e2e-token-healing')
  capturedTokenId = (await singleActiveToken(projectName)).id
  await pageFrame(gotoAccessTokens, 'tokens-provisioned')
})

storyboardStep(When, "the developer revokes the automation token behind the framework's back", async () => {
  const token = await singleActiveToken(projectName)
  const res = await revokeProjectAccessToken(projectName, token.id, await getRootHeaders())
  if (res.status >= 400) throw new Error(`Failed to revoke token ${token.id} (${res.status})`)
  await pageFrame(gotoAccessTokens, 'tokens-revoked')
  if ((await activeTokens(projectName)).length !== 0) {
    throw new Error('Expected no active Commitizen token after external revocation')
  }
})

storyboardStep(When, "the developer runs the framework's init again", async () => {
  reRunInitCaptured()
  await initVerdictFrame('init-verdict-heal')
})

storyboardStep(Then, 'GitLab now holds a brand-new automation token', async () => {
  const token = await singleActiveToken(projectName)
  if (token.id === capturedTokenId) {
    throw new Error(`Token id was NOT rotated by the heal — still ${token.id}`)
  }
  capturedTokenId = token.id
  await pageFrame(gotoAccessTokens, 'tokens-healed')
})

storyboardStep(Then, "GitLab's CI/CD variable now matches the new token", async () => {
  const variable = await readProjectVariable(projectName, TOKEN, await getRootHeaders())
  if (!variable.data || !variable.data.value) {
    throw new Error(`CI/CD variable "${TOKEN}" is missing or empty after heal`)
  }
  await pageFrame(gotoCiCdVariables, 'variable-resynced')
})

storyboardStep(Then, 'the healed token clones the repository over HTTPS', async () => {
  await cloneProofFrame('clone-healed', TOKEN)
  await assertCloneWithVariable(TOKEN)
  await assertCloneWithVariable(RENOVATE_TOKEN)
})

storyboardStep(When, 'the developer runs init a second time', async () => {
  reRunInitCaptured()
  await initVerdictFrame('init-verdict-idempotent')
})

storyboardStep(Then, 'the second run leaves the healed token untouched', async () => {
  const token = await singleActiveToken(projectName)
  if (token.id !== capturedTokenId) {
    throw new Error(`Idempotency broken: token id changed from ${capturedTokenId} to ${token.id}`)
  }
  await pageFrame(gotoAccessTokens, 'tokens-idempotent')
})

// ===========================================================================
// VARIANT storyboard — @self-healing (chapter 2). The other two break modes:
// a tampered pipeline variable is repaired, and duplicate tokens are purged.
// ===========================================================================

storyboardStep(Given, 'a project the framework already set up and is healthy', async () => {
  await provisionInitialisedProject('e2e-token-healing-variants', { skipLogin: true })
  await singleActiveToken(projectName)
  await pageFrame(gotoAccessTokens, 'variant-healthy')
})

storyboardStep(When, "a duplicate automation token is planted behind the framework's back", async () => {
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

storyboardStep(When, 'the CI/CD variable is overwritten with a bad value', async () => {
  const res = await updateProjectVariable(projectName, TOKEN, { value: TAMPERED_VALUE }, await getRootHeaders())
  if (res.status >= 400) throw new Error(`Failed to tamper variable (${res.status}): ${JSON.stringify(res.data)}`)
  await pageFrame(gotoCiCdVariables, 'variant-tampered')
  const variable = await readProjectVariable(projectName, TOKEN, await getRootHeaders())
  if (!variable.data || variable.data.value !== TAMPERED_VALUE) {
    throw new Error('Expected the pipeline variable to carry the tampered value')
  }
})

storyboardStep(When, "the developer runs the framework's init once more", async () => {
  reRunInitCaptured()
  await initVerdictFrame('variant-init-verdict')
})

storyboardStep(Then, 'only one automation token survives the purge', async () => {
  await singleActiveToken(projectName)
  await pageFrame(gotoAccessTokens, 'variant-purged')
})

storyboardStep(Then, 'the healed CI/CD variable clones the repository again', async () => {
  const variable = await readProjectVariable(projectName, TOKEN, await getRootHeaders())
  if (!variable.data || variable.data.value === TAMPERED_VALUE) {
    throw new Error('Expected the pipeline variable to be healed away from the tampered value')
  }
  await cloneProofFrame('variant-clone-healed', TOKEN)
  await assertCloneWithVariable(TOKEN)
})

// ===========================================================================
// RELOAD storyboard — @self-healing (chapter 3). A project that drifted the way
// a live one does: someone loosened the default branch in the GitLab settings,
// someone edited a framework file in place, and the tokens are the ones from
// install day. ONE `task devsecops:reload` re-applies the project's own answers
// and redoes the GitLab setup — replacing tokens that still worked, which is
// exactly what init must NOT do (chapter 1).
// ===========================================================================

const RELOAD_PROJECT = 'e2e-framework-reload'
const PIPELINE_FILE = '.gitlab-ci.yml'
const HAND_EDIT = '# a hand-edited line the toolbox never wrote'

function protectedBranchUrl () {
  return `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/protected_branches/main`
}

async function pushAccessLevels () {
  const res = await freshGet(protectedBranchUrl(), await getRootHeaders())
  return ((res.data || {}).push_access_levels || []).map(l => l.access_level)
}

// Both automation tokens, by name, as { name: id } — the ids are what proves a
// reload replaced them rather than kept them.
async function automationTokenIds () {
  const tokens = await listProjectAccessTokens(projectName, await getRootHeaders())
  const active = (tokens.data || []).filter(t => t.active && !t.revoked)
  const ids = {}
  for (const name of [TOKEN, RENOVATE_TOKEN]) {
    const found = active.filter(t => t.name === name)
    if (found.length !== 1) {
      throw new Error(`Expected exactly 1 active token "${name}" for ${projectName}, found ${found.length}`)
    }
    ids[name] = found[0].id
  }
  return ids
}

function pipelineFileTail () {
  const content = fs.readFileSync(`${repoDirFor(projectName)}/${PIPELINE_FILE}`, 'utf8')
  const lines = content.replace(/\n+$/, '').split('\n').slice(-4).join('\n')
  return `$ tail -4 ${PIPELINE_FILE}\n${lines}`
}

// A project GENERATED from the template (so it carries a real answers file for
// the reload to read), pushed to its own GitLab project, with the GitLab side
// provisioned the way install day leaves it. Chapter 1 already signed the
// browser in, so no login here (see provisionInitialisedProject).
async function provisionGeneratedProject (name) {
  projectName = name
  await ensureLambdaUser()
  await GitLabProjectPage.deleteProjectIfExists(
    BASE_URL,
    process.env.TASK_GITLAB_ROOT_USER,
    process.env.TASK_GITLAB_ROOT_PASSWORD,
    projectPath(name)
  )
  const minted = await createLambdaPersonalAccessToken(
    `glab-cli-token-for-${name}`, ['api', 'write_repository'], await getRootHeaders()
  )
  glabToken = minted.token
  glabTokenId = minted.id

  // No README: the generated project's own first commit is what lands on main,
  // so the push below is a plain fast-forward.
  const created = await createProject(
    { name, visibility: 'public', initialize_with_readme: false },
    { 'PRIVATE-TOKEN': glabToken }
  )
  if (created.status >= 400) {
    throw new Error(`Failed to create project "${name}" (status ${created.status}): ${JSON.stringify(created.data)}`)
  }

  // Render at release 1.0.0 of a versioned copy of the template, so the answers
  // file records a release `copier recopy --vcs-ref :current:` can go back to.
  reloadTemplate = prepareVersionedTemplate()
  const rendered = renderProjectFromTemplate(reloadTemplate, '1.0.0')
  execSync(`rm -rf ${repoDirFor(name)} && mv ${rendered} ${repoDirFor(name)}`)

  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const remote = new URL(`${BASE_URL}/${lambdaUser}/${name}.git`)
  remote.username = lambdaUser
  remote.password = glabToken
  execSync(`git remote add origin ${remote} && git push -q -u origin main`, {
    cwd: repoDirFor(name), stdio: 'pipe', timeout: 120000
  })

  // The GitLab side only (tokens, merge settings, protected branch): the
  // toolchain is already installed by the chapters before this one, and
  // dev:setup-environment mutates it globally.
  const result = runTaskInRepoCaptured('task devsecops:init:configure', repoDirFor(name), glabToken, { timeout: 300000 })
  if (result.exitCode !== 0) {
    throw new Error(`task devsecops:init:configure failed on the generated project (exit ${result.exitCode}):\n${result.output}`)
  }
}

storyboardStep(Given, 'a project the framework set up, carrying both its automation tokens', async () => {
  await provisionGeneratedProject(RELOAD_PROJECT)
  tokenIdsBeforeReload = await automationTokenIds()
  await pageFrame(gotoAccessTokens, 'reload-tokens-before', { height: 900 })
})

storyboardStep(Given, 'someone loosened its default branch by hand', async () => {
  const headers = await getRootHeaders()
  // What a maintainer clicking through the settings does: drop the strict rule
  // and let Maintainers push to the default branch again.
  await freshDelete(protectedBranchUrl(), headers)
  const res = await freshPost(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/protected_branches?name=main&merge_access_level=40&push_access_level=40`,
    {}, headers
  )
  if (res.status >= 400) throw new Error(`Failed to loosen main (status ${res.status}): ${JSON.stringify(res.data)}`)
  await pageFrame(() => GitLabSettingsPage.gotoProtectedBranchAndMask(projectPath(projectName), projectName), 'reload-branch-loosened')
  if (!(await pushAccessLevels()).includes(40)) {
    throw new Error('Expected main to allow Maintainer pushes after the hand loosening')
  }
})

storyboardStep(Given, 'a framework file was edited in place', async () => {
  const repoDir = repoDirFor(projectName)
  fs.appendFileSync(`${repoDir}/${PIPELINE_FILE}`, `${HAND_EDIT}\n`)
  execSync('git commit --quiet --no-verify -am "chore: tweak the pipeline by hand"', { cwd: repoDir, stdio: 'pipe' })
  await renderPreFrame(I, 'reload-file-edited', pipelineFileTail())
  if (!fs.readFileSync(`${repoDir}/${PIPELINE_FILE}`, 'utf8').includes(HAND_EDIT)) {
    throw new Error(`Setup failed: ${PIPELINE_FILE} does not carry the hand edit`)
  }
})

storyboardStep(When, 'the developer reloads the framework', async () => {
  const result = runTaskInRepoCaptured('task devsecops:reload', repoDirFor(projectName), glabToken, { timeout: 600000 })
  global.lastTaskOutput = result.output
  if (result.exitCode !== 0) {
    throw new Error(`task devsecops:reload failed (exit ${result.exitCode}):\n${result.output}`)
  }
  const lines = filterTaskOutput(result.output)
    .map(line => line.replace(/token #\d+/g, 'token #<id>'))
  await renderPreFrame(I, 'reload-verdict', tailFromMarker(lines, RELOAD_MARKER, 30).join('\n'))
  // The twin of the "Force refresh: revoking existing token" lines on the card:
  // both tokens really are new ones. The access-tokens PAGE cannot show this —
  // it renders identically before and after (no id on screen, dates masked).
  const after = await automationTokenIds()
  for (const name of [TOKEN, RENOVATE_TOKEN]) {
    if (after[name] === tokenIdsBeforeReload[name]) {
      throw new Error(`Expected "${name}" to be a new token after the reload, still id ${after[name]}`)
    }
  }
})

storyboardStep(Then, 'the framework file is back to what the toolbox ships', async () => {
  await renderPreFrame(I, 'reload-file-restored', pipelineFileTail())
  if (fs.readFileSync(`${repoDirFor(projectName)}/${PIPELINE_FILE}`, 'utf8').includes(HAND_EDIT)) {
    throw new Error(`Expected the reload to restore ${PIPELINE_FILE}, the hand edit is still there`)
  }
})

storyboardStep(Then, 'the default branch is locked down again', async () => {
  await pageFrame(() => GitLabSettingsPage.gotoProtectedBranchAndMask(projectPath(projectName), projectName), 'reload-branch-strict')
  const levels = await pushAccessLevels()
  if (!levels.includes(0) || levels.includes(40)) {
    throw new Error(`Expected main to allow no push at all after the reload, got access levels ${JSON.stringify(levels)}`)
  }
})
