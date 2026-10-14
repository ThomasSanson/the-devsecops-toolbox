/* global inject Before After Given When Then document window MutationObserver */
/**
 * Self-healing storyboard: `task devsecops:init` repairs its own GitLab setup
 * and `task devsecops:reload` puts a drifted project back.
 * ONE Gherkin sentence = ONE card = ONE pixel baseline, asserted inside the step
 * (tolerance: 0). Every card is a real GitLab page at 1440 px (gitlabFrame):
 * the access tokens, the CI/CD variables, the protected branches or a commit.
 * What a command prints is a twin of its card, checked line by line, together
 * with REST on the same fact.
 *
 * Chapters 1 and 2 share one project, set up through workspaceRepo (a clone, a
 * copy of /workspace and a first `task devsecops:init`). Chapter 3 renders its
 * own project from the versioned template, so the reload has answers to read.
 */

const fs = require('fs')
const { execSync } = require('child_process')
const { I, GitLabUserPage, GitLabProjectPage } = inject()
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
  updateProjectVariable,
  listProjectMergeRequests,
  listProjectPipelines,
  getRepositoryFile,
  listCommits
} = require('../helpers/gitlabApi')
const { bootstrapWorkspaceRepo, runTaskInRepoCaptured } = require('../helpers/workspaceRepo')
const { freshGet, freshPost, freshDelete } = require('../helpers/http')
const { prepareVersionedTemplate, renderProjectFromTemplate } = require('../helpers/copierRender')
const { gitlabUrl, gitlabFrame } = require('../helpers/gitlabCard')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const TOKEN = 'TASK_COMMITIZEN_TOKEN'
const RENOVATE_TOKEN = 'TASK_RENOVATE_TOKEN'
const TAMPERED_VALUE = 'tampered-by-e2e'

// Per-scenario state.
let projectName = null
let glabToken = null
let glabTokenId = null
let revokedTokenId = null
let healedTokenId = null
let reloadTemplate = null
let tokenIdsBeforeReload = null

function repoDirFor (name) {
  return `/tmp/${name}-repo`
}

Before(() => {
  projectName = null
  glabToken = null
  glabTokenId = null
  revokedTokenId = null
  healedTokenId = null
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
// Setup + REST helpers.
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

// The lambda user signed in, a fresh project, and the first `task
// devsecops:init` that provisions the tokens, the CI/CD variables and the
// branch protection (bootstrapWorkspaceRepo also sets up the dev toolchain and
// glab auth, which chapter 3 relies on).
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

  const minted = await createLambdaPersonalAccessToken(
    `glab-cli-token-for-${name}`, ['api', 'write_repository'], await getRootHeaders()
  )
  glabToken = minted.token
  glabTokenId = minted.id
  bootstrapWorkspaceRepo(name, repoDirFor(name), glabToken, { runInit: true, timeout: 600000 })
}

// Run a task in the project's working tree; its output is the card's twin.
function runTask (command) {
  let result = runTaskInRepoCaptured(command, repoDirFor(projectName), glabToken, { timeout: 600000 })
  if (result.exitCode === 201) {
    result = runTaskInRepoCaptured(command, repoDirFor(projectName), glabToken, { timeout: 600000 })
  }
  if (result.exitCode !== 0) {
    throw new Error(`${command} failed (exit ${result.exitCode}):\n${result.output}`)
  }
  return result.output
}

// GitLab creates pipelines and push-option merge requests in the background.
async function waitFor (what, check, { tries = 30, delayMs = 2000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const value = await check()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

function assertPrinted (output, lines) {
  for (const line of lines) {
    if (!output.includes(line)) throw new Error(`Expected the command to print "${line}", it did not:\n${output}`)
  }
}

// Every token of the project, active or not, by name.
async function tokensNamed (name) {
  const tokens = await listProjectAccessTokens(projectName, await getRootHeaders())
  if (tokens.status >= 400) throw new Error(`Listing the access tokens of ${projectName} failed (${tokens.status})`)
  return (tokens.data || []).filter(t => t.name === name)
}

// The release tokens as GitLab's two tables list them: active and revoked.
async function releaseTokens () {
  const all = await tokensNamed(TOKEN)
  return { active: all.filter(t => t.active && !t.revoked), revoked: all.filter(t => t.revoked) }
}

async function assertReleaseTokens (activeCount, revokedCount) {
  const { active, revoked } = await releaseTokens()
  if (active.length !== activeCount || revoked.length !== revokedCount) {
    throw new Error(`Expected ${activeCount} active and ${revokedCount} revoked "${TOKEN}" for ${projectName}, ` +
      `found ${active.length} active and ${revoked.length} revoked`)
  }
  return { active, revoked }
}

async function variableValue (name) {
  const variable = await readProjectVariable(projectName, name, await getRootHeaders())
  const value = variable.data && variable.data.value
  if (!value) throw new Error(`CI/CD variable "${name}" is missing or empty for ${projectName}`)
  return value
}

// A real authenticated clone with the CI/CD variable's token value.
async function assertCloneWithVariable (variableName) {
  const tokenValue = await variableValue(variableName)
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
// GitLab cards.
// ---------------------------------------------------------------------------

// The access-tokens columns that change on every run: when a token was created,
// last used (init signs in with each token on every run) and from where, and
// when it expires. Blanked cell by cell, kept blank through a redraw, so the
// table keeps its layout whatever GitLab printed there.
const VOLATILE_TOKEN_COLUMNS = ['Created', 'Last Used', 'Last Used IPs', 'Expires']

// The access-tokens page: "Active project access tokens" and, below, the
// inactive ones GitLab keeps marked "Revoked". `rows` = [active, inactive], the
// row counts the REST twin expects, waited for so a half-loaded table is never shot.
async function tokensFrame (frameName, [active, inactive]) {
  await gitlabFrame(I, frameName, gitlabUrl.accessTokens(projectName), {
    height: 760,
    waitText: 'Active project access tokens',
    prepare: async () => {
      // waitForFunction hands its argument array over as ONE argument.
      await I.waitForFunction(([a, i]) => {
        const rows = (id) => document.querySelectorAll(`#${id} tbody tr`).length
        return rows('active-project-access-tokens') === a && rows('inactive-project-access-tokens') === i
      }, [active, inactive], 60)
      await I.executeScript((labels) => {
        const cells = labels.map(l => `td[data-label="${l}"]`).join(', ')
        const blank = () => document.querySelectorAll(cells).forEach(td => { if (td.textContent !== '') td.textContent = '' })
        blank()
        if (window.__e2eTokenCells) window.__e2eTokenCells.disconnect()
        window.__e2eTokenCells = new MutationObserver(blank)
        window.__e2eTokenCells.observe(document.body, { childList: true, subtree: true, characterData: true })
      }, VOLATILE_TOKEN_COLUMNS)
    }
  })
}

// CI/CD settings, Variables open, values revealed the way a maintainer checks
// them. A real token keeps the prefix GitLab gives it ("glpat-") and loses its
// secret part to "*****"; the masks match the exact values read by REST, and
// the capture is refused while one of them is still on the page.
async function variablesFrame (frameName) {
  const table = '[data-testid="ci-variable-table"]'
  const secrets = []
  for (const name of [TOKEN, RENOVATE_TOKEN]) {
    const value = await variableValue(name)
    if (value !== TAMPERED_VALUE) secrets.push(value)
  }
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  await gitlabFrame(I, frameName, gitlabUrl.ciSettings(projectName), {
    height: 760,
    textMasks: secrets.map(s => [new RegExp(escape(s)), `${(s.match(/^[a-z]+-/) || [''])[0]}*****`]),
    prepare: async () => {
      const open = '#js-cicd-variables-settings.expanded'
      if (!await I.grabNumberOfVisibleElements(open)) await I.click('Expand', '#js-cicd-variables-settings')
      await I.waitForElement(open, 30)
      await I.waitForVisible(table, 30)
      await I.click('Reveal values', table)
      await I.waitForElement('[data-testid="revealedValue"]', 30)
    },
    // Runs after the mask, right before the capture.
    scrollTo: async () => {
      await I.executeScript((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), table)
      const leaked = await I.executeScript((values) => values.filter(v => document.body.innerText.includes(v)).length, secrets)
      if (leaked) throw new Error(`${frameName}: ${leaked} token value(s) still readable on the page`)
    }
  })
}

// Repository settings, "Protected branches" open and at the top of the card.
async function protectedBranchFrame (frameName) {
  const section = '#js-protected-branches-settings'
  await gitlabFrame(I, frameName, gitlabUrl.repoSettings(projectName), {
    height: 640,
    prepare: async () => {
      if (!await I.grabNumberOfVisibleElements(`${section}.expanded`)) await I.click('Expand', section)
      await I.waitForElement(`${section}.expanded`, 30)
      await I.waitForFunction(([sel]) => (document.querySelector(sel) || {}).textContent.includes('Allowed to push and merge'), [section], 30)
    },
    scrollTo: () => I.executeScript((sel) => document.querySelector(sel).scrollIntoView({ block: 'start' }), section)
  })
}

// A commit page: its title, its branch, its merge request and its diff. The
// pipeline row carries a global id and a status, and the Pipelines tab a count
// that depends on timing: both go. The tab itself only exists once GitLab has
// created the commit's pipeline, so the card waits for it.
async function commitFrame (frameName, sha, { waitText, prepare = null }) {
  const headers = await getRootHeaders()
  await waitFor(`a pipeline for commit ${sha}`, async () =>
    ((await listProjectPipelines(projectName, headers, `?sha=${sha}`)).data || []).length)
  await gitlabFrame(I, frameName, gitlabUrl.commit(projectName, sha), {
    height: 700,
    waitText,
    prepare,
    hide: ['.well-segment:has([data-testid="pipeline-path"])', '.js-pipelines-mr-count']
  })
}

// ===========================================================================
// Chapter 1: a revoked release token is rebuilt, and a second init is a no-op.
// ===========================================================================

storyboardStep(Given, 'a project the framework set up, whose release token someone then revoked in GitLab', async () => {
  await provisionInitialisedProject('e2e-token-healing')
  const { active } = await assertReleaseTokens(1, 0)
  revokedTokenId = active[0].id
  const res = await revokeProjectAccessToken(projectName, revokedTokenId, await getRootHeaders())
  if (res.status >= 400) throw new Error(`Failed to revoke token ${revokedTokenId} (${res.status})`)
  const { revoked } = await assertReleaseTokens(0, 1)
  if (revoked[0].id !== revokedTokenId) throw new Error(`Expected token ${revokedTokenId} to be the revoked one, found ${revoked[0].id}`)
  await tokensFrame('tokens-revoked', [1, 1])
})

storyboardStep(When, "the developer runs the framework's init again, a brand-new release token takes the revoked one's place", async () => {
  assertPrinted(runTask('task devsecops:init'), [`Token created and CI/CD variable '${TOKEN}' stored`])
  const { active } = await assertReleaseTokens(1, 1)
  healedTokenId = active[0].id
  if (healedTokenId === revokedTokenId) throw new Error(`The heal kept the revoked token ${revokedTokenId}`)
  // Both variables carry a token that really works.
  await assertCloneWithVariable(TOKEN)
  await assertCloneWithVariable(RENOVATE_TOKEN)
  await tokensFrame('tokens-healed', [2, 1])
})

storyboardStep(When, 'the developer runs init a second time, GitLab keeps that release token and revokes nothing', async () => {
  assertPrinted(runTask('task devsecops:init'), [`Token '${TOKEN}' exists and is valid`])
  const { active } = await assertReleaseTokens(1, 1)
  if (active[0].id !== healedTokenId) {
    throw new Error(`The second init replaced the release token: ${healedTokenId} became ${active[0].id}`)
  }
  await tokensFrame('tokens-idempotent', [2, 1])
})

// ===========================================================================
// Chapter 2, same project: a planted duplicate and a tampered variable.
// ===========================================================================

storyboardStep(When, 'someone plants a second release token with the same name in GitLab', async () => {
  const expiresAt = new Date(Date.now() + 300 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const res = await createProjectAccessToken(projectName, {
    name: TOKEN, scopes: ['api', 'write_repository'], access_level: 40, expires_at: expiresAt
  }, await getRootHeaders())
  if (res.status >= 400) throw new Error(`Failed to plant duplicate token (${res.status}): ${JSON.stringify(res.data)}`)
  await assertReleaseTokens(2, 1)
  await tokensFrame('tokens-duplicate', [3, 1])
})

storyboardStep(When, "someone overwrites the release token's CI/CD variable with a bad value", async () => {
  const res = await updateProjectVariable(projectName, TOKEN, { value: TAMPERED_VALUE }, await getRootHeaders())
  if (res.status >= 400) throw new Error(`Failed to tamper variable (${res.status}): ${JSON.stringify(res.data)}`)
  if (await variableValue(TOKEN) !== TAMPERED_VALUE) throw new Error('Expected the CI/CD variable to carry the tampered value')
  await variablesFrame('variables-tampered')
})

storyboardStep(When, "the developer runs the framework's init once more, a single release token is left", async () => {
  assertPrinted(runTask('task devsecops:init'), ['Purging duplicates', 'out of sync. Rotating'])
  // Revoked: chapter 1's token, init's own older duplicate (the purge keeps the
  // newest), and the planted one, replaced because the variable no longer matched it.
  await assertReleaseTokens(1, 3)
  await tokensFrame('tokens-purged', [2, 3])
})

storyboardStep(Then, 'the CI/CD variable holds a GitLab token again instead of the bad value', async () => {
  if (await variableValue(TOKEN) === TAMPERED_VALUE) throw new Error('The CI/CD variable still carries the tampered value')
  await assertCloneWithVariable(TOKEN)
  await variablesFrame('variables-healed')
})

// ===========================================================================
// Chapter 3: a project that drifted the way a live one does, put back by ONE
// `task devsecops:reload`, which replaces tokens that still worked: exactly what
// init must NOT do (chapter 1).
// ===========================================================================

const RELOAD_PROJECT = 'e2e-framework-reload'
const PIPELINE_FILE = '.gitlab-ci.yml'
const HAND_EDIT = '# a hand-edited line the toolbox never wrote'
const HAND_EDIT_TITLE = 'chore: tweak the pipeline by hand'
const RESTORE_BRANCH = 'reload-framework'
const RESTORE_TITLE = 'chore: put the framework files back'

function protectedBranchUrl () {
  return `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/protected_branches/main`
}

async function pushAccessLevels () {
  const res = await freshGet(protectedBranchUrl(), await getRootHeaders())
  return ((res.data || {}).push_access_levels || []).map(l => l.access_level)
}

// Both automation tokens, by name, as { name: id }: the ids are what proves a
// reload replaced them rather than kept them.
async function automationTokenIds () {
  const ids = {}
  for (const name of [TOKEN, RENOVATE_TOKEN]) {
    const found = (await tokensNamed(name)).filter(t => t.active && !t.revoked)
    if (found.length !== 1) {
      throw new Error(`Expected exactly 1 active token "${name}" for ${projectName}, found ${found.length}`)
    }
    ids[name] = found[0].id
  }
  return ids
}

function git (command) {
  return execSync(command, { cwd: repoDirFor(projectName), stdio: 'pipe', timeout: 120000, encoding: 'utf8' }).trim()
}

// A project GENERATED from the template (so it carries a real answers file for
// the reload to read), pushed to its own GitLab project, with the GitLab side
// provisioned the way install day leaves it. Chapter 1 already signed the
// browser in.
async function provisionGeneratedProject (name) {
  projectName = name
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
  git(`git remote add origin ${remote} && git push -q -u origin main`)

  // The GitLab side only (tokens, merge settings, protected branch): the
  // toolchain is already installed by chapter 1, and dev:setup-environment
  // mutates it globally.
  runTask('task devsecops:init:configure')
}

storyboardStep(Given, 'a project the framework set up, whose main branch someone then loosened by hand', async () => {
  await provisionGeneratedProject(RELOAD_PROJECT)
  tokenIdsBeforeReload = await automationTokenIds()
  const headers = await getRootHeaders()
  // What a maintainer clicking through the settings does: drop the strict rule
  // and let Maintainers push to the main branch again.
  await freshDelete(protectedBranchUrl(), headers)
  const res = await freshPost(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/protected_branches?name=main&merge_access_level=40&push_access_level=40`,
    {}, headers
  )
  if (res.status >= 400) throw new Error(`Failed to loosen main (status ${res.status}): ${JSON.stringify(res.data)}`)
  if (!(await pushAccessLevels()).includes(40)) {
    throw new Error('Expected main to allow Maintainer pushes after the hand loosening')
  }
  await protectedBranchFrame('reload-branch-loosened')
})

storyboardStep(Given, 'someone pushed a hand edit of the pipeline file straight to the main branch', async () => {
  fs.appendFileSync(`${repoDirFor(projectName)}/${PIPELINE_FILE}`, `${HAND_EDIT}\n`)
  // The push goes through only because the main branch was loosened.
  git(`git commit --quiet --no-verify -am "${HAND_EDIT_TITLE}" && git push -q --no-verify origin main`)
  const sha = git('git rev-parse HEAD')
  const headers = await getRootHeaders()
  const head = (await listCommits(projectName, 'main', headers))[0]
  if (head.id !== sha || head.title !== HAND_EDIT_TITLE) {
    throw new Error(`Expected "${HAND_EDIT_TITLE}" (${sha}) on top of main, found "${head.title}" (${head.id})`)
  }
  if (!(await getRepositoryFile(projectName, PIPELINE_FILE, 'main', headers)).includes(HAND_EDIT)) {
    throw new Error(`${PIPELINE_FILE} on main does not carry the hand edit`)
  }
  await commitFrame('reload-hand-edit', sha, { waitText: HAND_EDIT })
})

storyboardStep(When, 'the developer reloads the framework, both automation tokens are revoked and replaced by new ones', async () => {
  const output = runTask('task devsecops:reload')
  assertPrinted(output, ['♻️ Framework reloaded'])
  const refreshes = output.split('Force refresh: revoking existing token').length - 1
  if (refreshes !== 2) throw new Error(`Expected reload to force-refresh 2 tokens, it refreshed ${refreshes}:\n${output}`)
  const after = await automationTokenIds()
  for (const name of [TOKEN, RENOVATE_TOKEN]) {
    if (after[name] === tokenIdsBeforeReload[name]) {
      throw new Error(`Expected "${name}" to be a new token after the reload, still id ${after[name]}`)
    }
    const old = (await tokensNamed(name)).find(t => t.id === tokenIdsBeforeReload[name])
    if (!old || !old.revoked) throw new Error(`Expected the install-day "${name}" (${tokenIdsBeforeReload[name]}) to be revoked`)
  }
  await tokensFrame('reload-tokens-replaced', [2, 2])
})

storyboardStep(Then, 'the main branch is locked down again', async () => {
  const levels = await pushAccessLevels()
  if (!levels.includes(0) || levels.includes(40)) {
    throw new Error(`Expected main to allow no push at all after the reload, got access levels ${JSON.stringify(levels)}`)
  }
  await protectedBranchFrame('reload-branch-strict')
})

storyboardStep(Then, 'the developer sends the restored pipeline file back through a merge request', async () => {
  // reload touched exactly one file: the pipeline file, without the hand edit.
  const changed = git('git status --porcelain')
  if (changed !== `M ${PIPELINE_FILE}`) throw new Error(`Expected reload to change only ${PIPELINE_FILE}, git status says:\n${changed}`)
  if (fs.readFileSync(`${repoDirFor(projectName)}/${PIPELINE_FILE}`, 'utf8').includes(HAND_EDIT)) {
    throw new Error(`Expected the reload to restore ${PIPELINE_FILE}, the hand edit is still there`)
  }
  git(`git switch -q -c ${RESTORE_BRANCH} && git commit --quiet --no-verify -am "${RESTORE_TITLE}" && ` +
    `git push -q --no-verify -o merge_request.create -o merge_request.target=main origin ${RESTORE_BRANCH}`)
  const sha = git('git rev-parse HEAD')
  const headers = await getRootHeaders()
  const mrs = await waitFor(`a merge request from ${RESTORE_BRANCH}`, async () => {
    const found = (await listProjectMergeRequests(projectName, headers, `?source_branch=${RESTORE_BRANCH}`)).data || []
    return found.length && found
  })
  if (mrs.length !== 1 || mrs[0].target_branch !== 'main') {
    throw new Error(`Expected one merge request from ${RESTORE_BRANCH} to main, found ${JSON.stringify(mrs.map(m => [m.iid, m.target_branch]))}`)
  }
  const diff = (await freshGet(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/repository/commits/${sha}/diff`, headers
  )).data || []
  if (diff.length !== 1 || diff[0].new_path !== PIPELINE_FILE || !diff[0].diff.includes(`-${HAND_EDIT}`)) {
    throw new Error(`Expected the commit to remove the hand edit from ${PIPELINE_FILE} only, got ${JSON.stringify(diff.map(d => d.new_path))}`)
  }
  await commitFrame('reload-restore', sha, {
    waitText: HAND_EDIT,
    prepare: () => I.waitForText('1 merge request', 60)
  })
})
