/* global inject Before After Given When Then NodeFilter */
/**
 * Source publication — @source-publication.
 *
 * A private project publishes its source to a PUBLIC project, minus the files
 * the team decided never leave, and only after an owner approved the exact
 * list. Everything here is the real product against the real test GitLab:
 *
 *   - the private project is a REAL copier render of the working-branch
 *     template (source_publication=true), pushed to a REAL private project;
 *   - the destination is a REAL second project on the same GitLab, public;
 *   - every terminal card runs the REAL entry point (`task release`,
 *     `task publication:check`) in a live ttyd shell;
 *   - the approval merge request is the one the toolbox itself opens, and its
 *     thread is answered through the API by two DIFFERENT real users, so the
 *     "who signed off" check is exercised both ways.
 *
 * No CI runner is involved, on purpose: the feature's promise is that the same
 * command works from a developer's machine and from the pipeline, so the story
 * runs it from the machine.
 *
 * Every card is twinned with a check of the same fact — the terminal's own
 * words for what the toolbox said, the REST API for what actually reached the
 * public project — so a regression fails loud even without eyes.
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { I, GitLabRepositoryPage, GitLabMergeRequestPage, GitLabUserPage } = inject()
const {
  ttydPort,
  shellEscape,
  execInContainerAsUser,
  stripAnsiEscapeSequences
} = require('../helpers/docker')
const {
  BASE_URL,
  projectPath,
  encodedProjectPath,
  getRootHeaders,
  curlAuthFlags,
  createProject,
  deleteProject,
  listRepositoryTree,
  listProjectMergeRequests,
  mergeMergeRequest,
  updateProjectSettings,
  revokePersonalAccessToken,
  readProjectVariable,
  listProjectAccessTokens,
  listPipelineSchedules,
  createProjectVariable,
  listPipelineJobs,
  getPipeline
} = require('../helpers/gitlabApi')
const { freshGet, freshPost, freshPut } = require('../helpers/http')
const {
  registerScopedRunner,
  teardownScopedRunner,
  cancelRedundantPipelines,
  maskPipelinePage,
  PIPELINE_TIMEOUT_MS
} = require('../helpers/pipelineRunner')
const { renderProject, removeRendered } = require('../helpers/copierRender')
const {
  PROJECT_DIR,
  INSTALL_LOG,
  WRAPPER_PATH,
  setupClonedProjectTerminal,
  prepareWorkingBranchInstaller,
  preinstallToolchain,
  teardownJourneyTerminal
} = require('../helpers/journeyContainer')
const {
  typeCommandAndWait,
  waitForTerminalText,
  waitForTerminalSettle,
  captureTerminalFrame,
  COMMAND_TIMEOUT_MS
} = require('../terminal/capture')
const {
  storyboardStep,
  addStoryboardFrame,
  capturePageFrame
} = require('../../../../../.config/codeceptjs/storyboard')

// The owner: a SECOND real GitLab user, so "signed off by someone who is not an
// owner" and "signed off by an owner" are two different people, not a fiction.
const OWNER_USERNAME = 'publication-owner'
const OWNER_NAME = 'Publication Owner'
const OWNER_EMAIL = 'publication-owner@test.local'
// The same throwaway password the suite already gives its test users, read from
// the environment rather than written down again: a second literal beside a
// username is a credential as far as the secret scanner is concerned, and it is
// right to say so.
const ownerPassword = () => process.env.TASK_GITLAB_LAMBDA_PASSWORD

// The version the private project sits on. The publication mirrors it, which is
// what makes the public history read as a release log.
const FIXTURE_TAG = '1.4.0'

// The three files the lists let out, in the order the tool prints them.
const PUBLISHED = ['README.md', 'src/app.js', 'src/server/http.js']
// Matched by the allowlist and taken back: one by the framework floor a project
// cannot empty, one by the project's own denylist.
const WITHHELD_BY_FLOOR = 'src/certs/service.key'
const WITHHELD_BY_DENYLIST = 'src/internal/customer-keys.js'
// Never allowed in the first place — the allowlist simply does not name it.
const NEVER_ALLOWED = 'deploy/production.yml'
// Chapter 4: a new file inside a folder that has been published for weeks.
const LATE_ARRIVAL = 'src/server/token-store.js'

// What the terminal really prints but the cards must not embed:
//   - the per-run project name (a fresh random suffix on every run);
//   - the number of framework files outside the allowlist, which moves with
//     every template change.
// Masked at capture time, so the row keeps its colours and its place.
const TERMINAL_MASKS = [
  [/e2e-journey-[0-9a-f]+/g, 'project'],
  [/\b\d+ other tracked files\b/g, '<n> other tracked files']
]

Before(() => {
  global.pubContainer = null
  global.pubPrivate = null
  global.pubPublic = null
  global.pubRendered = null
  global.pubTokens = []
  global.pubLambdaToken = null
  global.pubOwnerToken = null
  global.pubMrIid = null
  global.pubRunner = null
  global.pubCiPid = 0
})

After(async () => {
  teardownJourneyTerminal(global.pubContainer)
  global.pubContainer = null

  // Surgical: only this scenario's runner, so a full local run does not pull the
  // rug from under the other stories sharing the gitlab-runner service.
  if (global.pubRunner) {
    try {
      await teardownScopedRunner(global.pubRunner)
    } catch (_) {
      // Best-effort: the project is deleted just below anyway.
    }
    global.pubRunner = null
  }

  removeRendered(global.pubRendered)
  global.pubRendered = null

  let rootHeaders = null
  try {
    rootHeaders = await getRootHeaders()
  } catch (_) {
    return
  }

  for (const name of [global.pubPrivate, global.pubPublic]) {
    if (!name) continue
    try {
      await deleteProject(name, rootHeaders)
    } catch (_) {
      // Best-effort: GitLab deletion is async and non-critical.
    }
  }
  global.pubPrivate = null
  global.pubPublic = null

  for (const id of global.pubTokens || []) {
    try {
      await revokePersonalAccessToken(id, rootHeaders)
    } catch (_) {
      // Best-effort: per-scenario tokens must not pile up on the GitLab volume.
    }
  }
  global.pubTokens = []
})

// ---------------------------------------------------------------------------
// GitLab helpers the shared module does not carry: a second user and its token,
// project membership, and merge-request threads.
// ---------------------------------------------------------------------------

function lambdaUser () {
  return process.env.TASK_GITLAB_LAMBDA_USER
}

async function userIdOf (username, headers) {
  const res = await freshGet(`${BASE_URL}/api/v4/users?username=${username}`, headers)
  if (!res.data || !res.data.length) throw new Error(`No GitLab user "${username}"`)
  return res.data[0].id
}

async function personalAccessTokenFor (username, tokenName, headers) {
  const userId = await userIdOf(username, headers)
  const res = await freshPost(
    `${BASE_URL}/api/v4/users/${userId}/personal_access_tokens`,
    { name: tokenName, scopes: ['api', 'write_repository'] },
    headers
  )
  if (!res.data || !res.data.token) {
    throw new Error(`Failed to mint a token for "${username}": ${JSON.stringify(res.data)}`)
  }
  global.pubTokens.push(res.data.id)
  return res.data.token
}

async function addProjectMember (projectName, username, accessLevel, headers) {
  const userId = await userIdOf(username, headers)
  return freshPost(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/members`,
    { user_id: userId, access_level: accessLevel },
    headers
  )
}

// The one thread the toolbox opened — the resolvable, human-written one, never
// a system note ("added 1 commit", "changed the description").
async function approvalThread (iid, headers) {
  const res = await freshGet(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(global.pubPrivate)}/merge_requests/${iid}/discussions`,
    headers
  )
  const threads = res.data || []
  const thread = threads.find(t => (t.notes || []).some(n => n.resolvable && !n.system))
  if (!thread) {
    throw new Error(
      `No resolvable thread on !${iid} — the toolbox must open one for the owners to answer. Threads: ` +
      JSON.stringify(threads.map(t => (t.notes || []).map(n => ({ system: n.system, resolvable: n.resolvable }))))
    )
  }
  return thread
}

async function setThreadResolved (iid, threadId, resolved, headers) {
  const res = await freshPut(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(global.pubPrivate)}` +
    `/merge_requests/${iid}/discussions/${threadId}?resolved=${resolved}`,
    {},
    headers
  )
  if (res.status >= 400) {
    throw new Error(`Failed to set thread ${threadId} resolved=${resolved}: ${res.status} ${JSON.stringify(res.data)}`)
  }
}

async function openApprovalMergeRequest (headers) {
  const res = await listProjectMergeRequests(global.pubPrivate, headers, '?state=opened')
  const mrs = res.data || []
  if (!mrs.length) throw new Error('The toolbox opened no merge request to ask for approval')
  return mrs[0]
}

/**
 * GitLab computes a merge request's diff asynchronously after the push, so the
 * Changes tab can still be empty seconds after the merge request exists. Wait on
 * the API for the file to be there, then open the page — the alternative, a
 * longer waitForText, hides the race instead of ending it.
 */
async function waitMrChanges (iid, headers, mustInclude) {
  const deadline = Date.now() + 120000
  let seen = []
  while (Date.now() < deadline) {
    const res = await freshGet(
      `${BASE_URL}/api/v4/projects/${encodedProjectPath(global.pubPrivate)}/merge_requests/${iid}/changes`,
      headers
    )
    const changes = (res.data && res.data.changes) || []
    seen = changes.map(c => c.new_path)
    if (seen.includes(mustInclude)) return changes
    await I.wait(2)
  }
  throw new Error(`!${iid} never showed a change to "${mustInclude}" (saw ${JSON.stringify(seen)})`)
}

async function publicTreePaths () {
  const headers = await getRootHeaders()
  const res = await listRepositoryTree(global.pubPublic, headers, '?ref=main&recursive=true&per_page=100')
  // An empty repository has no tree at all: GitLab answers 404 with an object,
  // not an empty array. That is the state chapter 2 asserts, so it is expected.
  const entries = Array.isArray(res.data) ? res.data : []
  return entries.filter(e => e.type === 'blob').map(e => e.path).sort()
}

// ---------------------------------------------------------------------------
// The fixture: a private project that really carries the framework and a few
// source files, pushed to a real GitLab project and cloned into a live shell.
// ---------------------------------------------------------------------------

function sh (cmd, cwd) {
  return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000, encoding: 'utf8' })
}

function writeFixtureFile (root, relPath, content) {
  const abs = path.join(root, relPath)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

/**
 * Render the working-branch template with the publication component on, drop a
 * handful of realistic source files into it, and write the two lists that
 * decide what may leave. Returns the rendered directory.
 */
function buildPrivateProjectTree () {
  const root = renderProject({ source_publication: true })

  writeFixtureFile(root, 'README.md', [
    '# Field Reporting',
    '',
    'A small service that collects field reports and renders them as a public',
    'dashboard. The source is published; the deployment is not.',
    ''
  ].join('\n'))
  writeFixtureFile(root, 'src/app.js', "const { serve } = require('./server/http')\n\nserve(process.env.PORT || 8080)\n")
  writeFixtureFile(root, 'src/server/http.js', "exports.serve = (port) => console.log('listening on ' + port)\n")
  // Committed by mistake months ago. The framework floor refuses it whatever the
  // allowlist says. The placeholder body keeps a real secret out of THIS
  // repository, while the file NAME is what the floor actually matches.
  writeFixtureFile(root, 'src/certs/service.key', 'placeholder-not-a-real-key\n')
  writeFixtureFile(root, 'src/internal/customer-keys.js', 'module.exports = { acme: process.env.ACME_KEY }\n')
  writeFixtureFile(root, 'deploy/production.yml', 'host: reporting.internal\nreplicas: 3\n')

  writeFixtureFile(root, '.config/publication/allowlist', [
    '# What may be published. Anything this file does not match never leaves.',
    '# Patterns are gitignore syntax, so a leading / anchors to the root:',
    '# "/README.md" is this project README, not every README in the tree.',
    '/README.md',
    '/src/**',
    ''
  ].join('\n'))
  writeFixtureFile(root, '.config/publication/denylist', [
    '# What must never be published, even when the allowlist matched it.',
    '# This file always wins.',
    'src/internal/',
    ''
  ].join('\n'))
  writeFixtureFile(root, '.config/publication/owners', [
    '# The people who may approve what becomes public.',
    OWNER_USERNAME,
    ''
  ].join('\n'))

  return root
}

/** Push the rendered tree to the (empty) private project, tagged like a release. */
function pushPrivateProject (root, token) {
  const url = `http://${lambdaUser()}:${encodeURIComponent(token)}@gitlab/${lambdaUser()}/${global.pubPrivate}.git`
  sh('git init --quiet --initial-branch=main', root)
  sh('git config user.email "lambda@test.local" && git config user.name "Lambda User"', root)
  sh('git add -A', root)
  sh('git commit --quiet --no-verify -m "feat: the field reporting service"', root)
  sh(`git tag ${FIXTURE_TAG}`, root)
  sh(`git push --quiet ${shellEscape(url)} main --tags`, root)
}

/**
 * The developer's local environment: what a laptop keeps in .env (never
 * versioned, never on camera) so `task release` publishes for real. The two
 * release switches keep the story on its subject — this machine is not the one
 * that pushes the tag.
 */
function writeLocalEnv (container, lambdaToken) {
  const lines = [
    '# Local developer environment (never versioned).',
    'TASK_COMMITIZEN_ENABLED=false',
    'TASK_DEVSECOPS_RELEASE_ALLOW_PUSH=false',
    'TASK_PUBLICATION_ENABLED=true',
    `TASK_PUBLICATION_TARGET_URL=http://gitlab/${lambdaUser()}/${global.pubPublic}.git`,
    `TASK_PUBLICATION_TOKEN_USERNAME=${lambdaUser()}`,
    `TASK_PUBLICATION_TOKEN=${lambdaToken}`,
    `TASK_PUBLICATION_SOURCE_TOKEN=${lambdaToken}`
  ]
  const res = execInContainerAsUser(container, 'bootstrap', [
    `cat > ${PROJECT_DIR}/.env <<'LOCAL_ENV'`,
    ...lines,
    'LOCAL_ENV',
    `chmod 600 ${PROJECT_DIR}/.env`
  ].join('\n'))
  if (res.exitCode !== 0) {
    throw new Error(`Failed to write the local .env in the journey container:\n${res.output}`)
  }
}

function inProject (script) {
  return execInContainerAsUser(global.pubContainer, 'bootstrap', `cd ${PROJECT_DIR} && ${script}`)
}

function inProjectOrThrow (script) {
  const res = inProject(script)
  if (res.exitCode !== 0) {
    throw new Error(`Command failed in the private project (\`${script}\`):\n${res.output}`)
  }
  return stripAnsiEscapeSequences(res.output || '')
}

/**
 * Bring the local main branch back in step with GitLab after a merge request
 * went in. Off camera: the story is about the publication, not about `git pull`.
 */
function pullMain () {
  inProjectOrThrow('git fetch --quiet origin main && git reset --hard --quiet origin/main')
}

/**
 * What the live terminal currently SAYS — the same rows the card photographs,
 * read back as text. The twin of every terminal card: the picture proves it to a
 * human, this proves it to the suite.
 */
async function terminalText () {
  const rows = await I.executeScript(function () {
    return Array.from(document.querySelectorAll('.xterm-rows > div'))
      .map(function (row) { return row.textContent || '' })
      .join('\n')
  })
  return String(rows || '')
}

/** Type a command in the live shell and keep the moment as a storyboard frame. */
async function terminalCard (command, marker, frameName) {
  await typeCommandAndWait(I, command, COMMAND_TIMEOUT_MS)
  await addStoryboardFrame(I, await captureTerminalFrame(I, frameName, { fromMarker: marker, mask: TERMINAL_MASKS }))
  return terminalText()
}

/** Re-open the live terminal after a card that navigated to a GitLab page. */
async function backToTerminal () {
  I.amOnPage(`http://${global.pubContainer}:${ttydPort()}`) // DevSkim: ignore DS162092
  I.waitForElement('.xterm-screen', 10)
  await I.wait(2)
  await typeCommandAndWait(I, 'clear')
}

/**
 * The merge-request page object keeps the project name on purpose (a story whose
 * project name is fixed wants its breadcrumb). This one's name carries a fresh
 * random suffix every run, so it is neutralised here, after the page object has
 * done the rest.
 */
async function maskProjectName () {
  await I.executeScript((name) => {
    const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walk.nextNode()) nodes.push(walk.currentNode)
    nodes.forEach(n => {
      if (re.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(re, 'project')
    })
  }, global.pubPrivate)
  await I.wait(0.3)
}

/**
 * What a GitLab page shows the reader but the story is not about, and which is
 * not the same twice: the one-off "new feature" callouts GitLab pops for a user
 * who has never dismissed them, any tooltip left hanging, and the row the mouse
 * happens to sit on. The pointer is parked in the corner rather than styled
 * away, so the picture stays a picture of the product.
 */
async function settlePageChrome () {
  await I.usePlaywrightTo('park the pointer outside the content', async ({ page }) => {
    await page.mouse.move(2, 2)
  })
  await I.executeScript(() => {
    const style = document.createElement('style')
    style.textContent = [
      '[role="tooltip"], .tooltip, .gl-tooltip { display: none !important }',
      '.user-callout, [data-testid*="callout"], [class*="popover"] { display: none !important }'
    ].join('\n')
    document.head.appendChild(style)
  })
  await I.wait(0.5)
}

async function gitlabCard (url, frameName, height = 640) {
  I.resizeWindow(1024, height)
  await I.amOnPage(url)
  // The private project's random name is what both projects are masked on: the
  // public one is that name plus "-public", so both read as "project".
  await GitLabRepositoryPage.maskVolatile(global.pubPrivate)
  await settlePageChrome()
  await addStoryboardFrame(I, await capturePageFrame(I, frameName))
  I.resizeWindow(1024, 768)
}

function mustContain (haystack, needles, what) {
  for (const needle of [].concat(needles)) {
    if (!haystack.includes(needle)) {
      throw new Error(`${what}: expected "${needle}" in:\n${haystack}`)
    }
  }
}

function mustNotContain (haystack, needles, what) {
  for (const needle of [].concat(needles)) {
    if (haystack.includes(needle)) {
      throw new Error(`${what}: did NOT expect "${needle}" in:\n${haystack}`)
    }
  }
}

async function assertPublicProjectHolds (expected, what) {
  const paths = await publicTreePaths()
  const wanted = [...expected].sort()
  if (JSON.stringify(paths) !== JSON.stringify(wanted)) {
    throw new Error(`${what}: expected ${JSON.stringify(wanted)}, found ${JSON.stringify(paths)}`)
  }
}

// ===========================================================================
// Chapter 1 — What would leave the private project
// ===========================================================================

storyboardStep(Given, 'a private project whose source has to be published somewhere public', async () => {
  const rootHeaders = await getRootHeaders()
  await GitLabUserPage.ensureUserViaApi(
    BASE_URL, process.env.TASK_GITLAB_ROOT_USER, process.env.TASK_GITLAB_ROOT_PASSWORD,
    {
      email: process.env.TASK_GITLAB_LAMBDA_EMAIL,
      username: lambdaUser(),
      name: 'Lambda User',
      password: process.env.TASK_GITLAB_LAMBDA_PASSWORD
    }
  )
  await GitLabUserPage.ensureUserViaApi(
    BASE_URL, process.env.TASK_GITLAB_ROOT_USER, process.env.TASK_GITLAB_ROOT_PASSWORD,
    { email: OWNER_EMAIL, username: OWNER_USERNAME, name: OWNER_NAME, password: ownerPassword() }
  )

  const suffix = crypto.randomBytes(4).toString('hex')
  global.pubPrivate = `e2e-journey-${suffix}`
  global.pubPublic = `${global.pubPrivate}-public`

  global.pubLambdaToken = await personalAccessTokenFor(lambdaUser(), `publication-${suffix}`, rootHeaders)
  global.pubOwnerToken = await personalAccessTokenFor(OWNER_USERNAME, `publication-owner-${suffix}`, rootHeaders)
  const lambdaHeaders = { 'PRIVATE-TOKEN': global.pubLambdaToken }

  for (const [name, visibility] of [[global.pubPrivate, 'private'], [global.pubPublic, 'public']]) {
    const created = await createProject(
      { name, visibility, initialize_with_readme: false },
      lambdaHeaders
    )
    if (created.status >= 400) {
      throw new Error(`Failed to create the ${visibility} project "${name}": ${created.status} ${JSON.stringify(created.data)}`)
    }
  }
  // The owner has to be able to answer the thread on the private project.
  await addProjectMember(global.pubPrivate, OWNER_USERNAME, 40, rootHeaders)
  // What `task glab:merge-settings` turns on in every toolbox project, and what
  // the sign-off leans on: GitLab itself refuses to merge while a thread is
  // open. Set here because this fixture is a plain render, not an inited
  // project — the setting is the product's, not the story's.
  await updateProjectSettings(
    global.pubPrivate,
    {
      only_allow_merge_if_all_discussions_are_resolved: true,
      // No runner is registered for this project, so a merge-request pipeline
      // would sit "running" for ever and repaint the merge widget on every
      // capture. The story is about the publication, not about CI.
      jobs_enabled: false
    },
    lambdaHeaders
  )

  global.pubRendered = buildPrivateProjectTree()
  pushPrivateProject(global.pubRendered, global.pubLambdaToken)

  global.pubContainer = setupClonedProjectTerminal(global.pubPrivate, global.pubLambdaToken)
  // The toolchain (task, uv) comes from the installer's own installers, so the
  // story never depends on a duplicated download path, and its volatile output
  // stays off camera.
  prepareWorkingBranchInstaller(global.pubContainer)
  preinstallToolchain(global.pubContainer)
  writeLocalEnv(global.pubContainer, global.pubLambdaToken)
  // A token-free origin backed by a credential store: the publication reads the
  // remote to find its own forge, and no token ever renders in a frame.
  inProjectOrThrow([
    `git remote set-url origin http://gitlab/${lambdaUser()}/${global.pubPrivate}.git`,
    'git config --global credential.helper store',
    `printf 'http://%s:%s@gitlab\\n' ${shellEscape(lambdaUser())} ${shellEscape(global.pubLambdaToken)} > "$HOME/.git-credentials"`,
    'chmod 600 "$HOME/.git-credentials"',
    'git fetch --quiet --tags origin'
  ].join(' && '))

  // The project is private: an anonymous browser is answered with the sign-in
  // form, and every GitLab card in this story would photograph that instead of
  // the product. Sign in once, as the developer whose project this is.
  await GitLabUserPage.loginAs(lambdaUser(), process.env.TASK_GITLAB_LAMBDA_PASSWORD)

  // Tall: the whole root listing has to be readable, deploy/ and src/ included.
  await gitlabCard(`/${projectPath(global.pubPrivate)}`, 'publication-private-before', 1300)

  const tracked = inProjectOrThrow('git ls-files')
  mustContain(tracked, [...PUBLISHED, WITHHELD_BY_FLOOR, WITHHELD_BY_DENYLIST, NEVER_ALLOWED],
    'The private project must really track the files the story reasons about')
})

storyboardStep(When, 'the developer opens the two files that decide what may be published', async () => {
  await backToTerminal()
  const screen = await terminalCard(
    'head -n 12 .config/publication/allowlist .config/publication/denylist',
    'head -n 12 .config/publication/allowlist',
    'publication-lists'
  )
  mustContain(screen, ['src/**', 'src/internal/'],
    'the two lists must really be the ones the story describes')
})

storyboardStep(Then, 'the toolbox names every file that would become public, and the ones it holds back', async () => {
  const screen = await terminalCard(
    'task publication:check', 'task publication:check', 'publication-check'
  )
  mustContain(screen, PUBLISHED, 'the check must name every file it would publish')
  mustContain(screen, [WITHHELD_BY_FLOOR, WITHHELD_BY_DENYLIST], 'the check must name what it holds back')
  mustNotContain(screen, [NEVER_ALLOWED],
    'a file the allowlist never matched is not "held back", it is simply outside the allowlist')
})

// ===========================================================================
// Chapter 2 — Nothing leaves until somebody has said yes
// ===========================================================================

storyboardStep(When, 'the developer runs the release on the main branch', async () => {
  const screen = await terminalCard('task release', 'task release', 'publication-release-refused')
  mustContain(screen, ['would become public for the first time', 'Nobody has approved', 'asks the owners to approve it'],
    'the release must refuse to publish a list nobody approved')
  mustContain(screen, 'Failed to run task',
    'a publication that did not happen must fail the release loudly, not warn quietly')
})

storyboardStep(Then, 'the public project is still empty', async () => {
  // Short: the only thing this card has to say is "the repository is empty".
  await gitlabCard(`/${projectPath(global.pubPublic)}`, 'publication-public-empty', 430)
  await assertPublicProjectHolds([], 'Nothing must have been published yet')
})

storyboardStep(Then, 'the toolbox opens a merge request asking the owners to approve the list', async () => {
  const headers = { 'PRIVATE-TOKEN': global.pubLambdaToken }
  const mr = await openApprovalMergeRequest(headers)
  global.pubMrIid = mr.iid
  mustContain(mr.description || '', `@${OWNER_USERNAME}`,
    'the approval merge request must notify the owners by name')
  const thread = await approvalThread(global.pubMrIid, headers)
  const note = (thread.notes || []).find(n => n.resolvable && !n.system)
  if (note.resolved) {
    throw new Error('the approval thread must start unanswered, so GitLab blocks the merge')
  }

  I.resizeWindow(1024, 690)
  await GitLabMergeRequestPage.gotoAndMask(
    projectPath(global.pubPrivate), global.pubMrIid, global.pubPrivate,
    { hideMergeWidget: false, keepContext: true, waitText: 'Merge blocked' }
  )
  await maskProjectName()
  await settlePageChrome()
  await addStoryboardFrame(I, await capturePageFrame(I, 'publication-approval-mr'))
  I.resizeWindow(1024, 768)
})

storyboardStep(Then, 'the merge request shows the exact list of paths that would become public', async () => {
  const headers = { 'PRIVATE-TOKEN': global.pubLambdaToken }
  const changes = await waitMrChanges(global.pubMrIid, headers, '.config/publication/manifest')

  I.resizeWindow(1440, 470)
  await GitLabMergeRequestPage.gotoChangesAndMask(
    projectPath(global.pubPrivate), global.pubMrIid, global.pubPrivate, '.config/publication/manifest'
  )
  await maskProjectName()
  await settlePageChrome()
  await addStoryboardFrame(I, await capturePageFrame(I, 'publication-approval-diff'))
  I.resizeWindow(1024, 768)

  const manifest = changes.find(c => c.new_path === '.config/publication/manifest')
  mustContain(manifest.diff, PUBLISHED.map(p => `+${p}`),
    'the manifest diff must list every path that would become public')
})

// ===========================================================================
// Chapter 3 — The right person has to be the one who says yes
// ===========================================================================

storyboardStep(When, 'the developer answers the question themselves and merges the merge request', async () => {
  const headers = { 'PRIVATE-TOKEN': global.pubLambdaToken }
  const thread = await approvalThread(global.pubMrIid, headers)
  await setThreadResolved(global.pubMrIid, thread.id, true, headers)
  const merged = await mergeMergeRequest(global.pubPrivate, global.pubMrIid, headers)
  if (merged.status >= 400) {
    throw new Error(`The developer's own merge must go through: ${merged.status} ${JSON.stringify(merged.data)}`)
  }
  await I.wait(3)

  I.resizeWindow(1024, 680)
  await GitLabMergeRequestPage.gotoAndMaskMerged(projectPath(global.pubPrivate), global.pubMrIid, global.pubPrivate)
  await maskProjectName()
  await settlePageChrome()
  await addStoryboardFrame(I, await capturePageFrame(I, 'publication-mr-merged'))
  I.resizeWindow(1024, 768)
})

storyboardStep(Then, 'the release still refuses, and names the person who answered', async () => {
  pullMain()
  await backToTerminal()
  const screen = await terminalCard('task release', 'task release', 'publication-release-wrong-signer')
  mustContain(screen, [`"${lambdaUser()}"`, 'is not an owner', OWNER_USERNAME],
    'the refusal must name who signed off and who was supposed to')
  mustContain(screen, 'Failed to run task', 'an unapproved publication must fail the release')
  await assertPublicProjectHolds([], 'Still nothing must have been published')
})

storyboardStep(When, 'an owner reopens the question on GitLab and answers it instead', async () => {
  const ownerHeaders = { 'PRIVATE-TOKEN': global.pubOwnerToken }
  const thread = await approvalThread(global.pubMrIid, { 'PRIVATE-TOKEN': global.pubLambdaToken })
  await setThreadResolved(global.pubMrIid, thread.id, false, ownerHeaders)
  await setThreadResolved(global.pubMrIid, thread.id, true, ownerHeaders)

  await backToTerminal()
  const screen = await terminalCard(
    'task publication:check', 'task publication:check', 'publication-approved-by-owner'
  )
  mustContain(screen, [OWNER_USERNAME, `!${global.pubMrIid}`],
    'the check must read the approval back and name the owner who gave it')
})

storyboardStep(Then, 'the release publishes the approved files, and only them', async () => {
  await typeCommandAndWait(I, 'clear')
  const screen = await terminalCard('task release', 'task release', 'publication-release-published')
  mustContain(screen, [`Approved by "${OWNER_USERNAME}"`, 'Pushed'], 'the release must say what it published')
  mustNotContain(screen, ['Failed to run task'], 'an approved publication must leave the release green')
})

storyboardStep(Then, 'the public project now carries the source, without the files that never leave', async () => {
  await gitlabCard(`/${projectPath(global.pubPublic)}`, 'publication-public-after')
  await assertPublicProjectHolds(PUBLISHED, 'The public project must carry exactly the approved files')
})

storyboardStep(Then, 'the folders that were held back are not inside it either', async () => {
  await gitlabCard(`/${projectPath(global.pubPublic)}/-/tree/main/src`, 'publication-public-src', 560)
  const paths = await publicTreePaths()
  for (const held of [WITHHELD_BY_FLOOR, WITHHELD_BY_DENYLIST]) {
    if (paths.includes(held)) {
      throw new Error(`"${held}" must never have reached the public project`)
    }
  }
})

storyboardStep(Then, 'the published history is one commit for that release', async () => {
  await gitlabCard(`/${projectPath(global.pubPublic)}/-/commits/main`, 'publication-public-history', 400)
  const headers = await getRootHeaders()
  const res = await freshGet(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(global.pubPublic)}/repository/commits?ref_name=main`,
    headers
  )
  const commits = res.data || []
  if (commits.length !== 1) {
    throw new Error(`The public history must hold exactly one commit, found ${commits.length}`)
  }
  mustContain(commits[0].message, [FIXTURE_TAG, global.pubPrivate],
    'the publication commit must name the release and the project it came from')
})

// ===========================================================================
// Chapter 4 — A file nobody approved does not slip through
// ===========================================================================

storyboardStep(When, 'a developer adds a new file inside a folder that is already published', async () => {
  await backToTerminal()
  await typeCommandAndWait(I, `printf 'exports.store = new Map()\\n' > ${LATE_ARRIVAL}`)
  await typeCommandAndWait(I, `git add ${LATE_ARRIVAL} && git commit -q -m "feat: remember the tokens between requests"`)
  const screen = await terminalCard('task release', 'task release', 'publication-late-arrival-refused')
  mustContain(screen, [LATE_ARRIVAL, 'would become public for the first time'],
    'a file that landed in an already-published folder must be named and refused')
  mustContain(screen, 'Failed to run task', 'the release must fail rather than publish an unapproved file')
})

storyboardStep(Then, 'the public project has not moved', async () => {
  // The SAME page as the card that opened the proof, so the reader compares two
  // panels instead of two subjects: the new file would have landed right here.
  await gitlabCard(`/${projectPath(global.pubPublic)}/-/tree/main/src`, 'publication-public-unchanged', 560)
  await assertPublicProjectHolds(PUBLISHED, 'The public project must be untouched')
  const paths = await publicTreePaths()
  if (paths.includes(LATE_ARRIVAL)) {
    throw new Error(`"${LATE_ARRIVAL}" must never have reached the public project`)
  }
})

// ===========================================================================
// Chapter 5 — The pipeline is what publishes, not a person
//
// Everything so far ran in a terminal, which is where a developer proves the
// rules. This chapter hands the same script to GitLab: the job the component
// ships, on the main branch, in the release stage. It refuses for the same
// reason and publishes under the same condition, and the token that may push
// lives in CI rather than on a laptop.
// ===========================================================================

// The one line the installer writes into a project that has no pipeline. The
// feedback job travels in the same shipped file and is switched off here: it
// runs Renovate, which is the update story's subject, and waiting on it would
// only make this card slower.
const STORY_PIPELINE = [
  '---',
  'include:',
  '  - local: .config/publication/gitlab-ci.yml',
  '',
  'feedback:',
  '  rules:',
  '    - when: never',
  ''
].join('\n')

/**
 * A job page, collapsed to the publication's own output: the runner's boilerplate
 * (image pull, clone, cache) is folded away exactly as a reader scrolls past it,
 * and the log gutter and timestamps go with it — they move on every run.
 */
async function publicationJobCard (jobId, frameName, height = 760) {
  I.resizeWindow(1400, height)
  await I.amOnPage(`/${projectPath(global.pubPrivate)}/-/jobs/${jobId}`)
  await I.waitForElement('[data-testid="job-log-content"]', 60)
  await I.waitForText('Source publication', 60)
  await maskPipelinePage(I, global.pubPrivate, { keepContext: true })
  await I.executeScript((marker) => {
    const lines = Array.from(document.querySelectorAll('.js-log-line.job-log-line'))
    const start = lines.findIndex(l => l.textContent.includes(marker))
    if (start > 0) lines.slice(0, start).forEach(l => { l.style.display = 'none' })
    document.querySelectorAll(
      '.job-log-line-number, [class*="log-line-timestamp"], [class*="line-timestamp"]'
    ).forEach(el => { el.style.display = 'none' })
    lines.forEach(l => {
      if (l.textContent.includes('Possibly zombie container')) l.style.display = 'none'
    })
  }, 'publish.sh publish')
  await maskProjectName()
  await settlePageChrome()
  await addStoryboardFrame(I, await capturePageFrame(I, frameName))
  I.resizeWindow(1024, 768)
}

/**
 * A job log is plain text, not JSON: it goes out through curl, like every other
 * trace read in this suite.
 */
function jobTrace (jobId, headers) {
  return sh(
    `curl -s ${curlAuthFlags(headers)} ` +
    `'${BASE_URL}/api/v4/projects/${encodedProjectPath(global.pubPrivate)}/jobs/${jobId}/trace'`,
    '/tmp'
  )
}

/**
 * The publish-source job of the newest pipeline on main, whatever its verdict.
 * `after` is the pipeline this story already read: a merge lands on main and
 * GitLab starts the next pipeline itself, so the wait has to be for a NEW one
 * rather than for a terminal state the old one already has.
 */
async function publicationJob (headers, after = 0) {
  const encoded = encodedProjectPath(global.pubPrivate)
  const deadline = Date.now() + PIPELINE_TIMEOUT_MS
  let pid = null
  let status = null
  let last = ''
  let tidied = false
  while (Date.now() < deadline) {
    if (!pid) {
      const list = await freshGet(
        `${BASE_URL}/api/v4/projects/${encoded}/pipelines?ref=main&order_by=id&sort=desc`, headers
      )
      const newest = (list.data || []).find(p => p.id > after)
      if (newest) pid = newest.id
    }
    // The approval merge request carries the framework's own pipeline, and
    // merging it starts one. On a single-slot runner that pipeline would run its
    // linter for minutes while the publication waits behind it, so it goes as
    // soon as the pipeline this story is about exists.
    if (pid && !tidied) {
      tidied = true
      await cancelRedundantPipelines(global.pubPrivate, pid, await getRootHeaders())
    }
    if (pid) {
      const pipe = await getPipeline(global.pubPrivate, pid, headers)
      status = pipe.data.status
      if (status !== last) { console.log(`main pipeline ${pid}: ${status}`); last = status }
      if (['success', 'failed', 'canceled', 'skipped'].includes(status)) break
    }
    await I.wait(5)
  }
  if (!pid) throw new Error(`No pipeline newer than ${after} ever ran on main`)
  const jobs = await listPipelineJobs(global.pubPrivate, pid, headers)
  const job = (jobs.data || []).find(j => j.name === 'publish-source')
  if (!job) {
    throw new Error(`Pipeline ${pid} carried no publish-source job: ${JSON.stringify((jobs.data || []).map(j => j.name))}`)
  }
  return { pid, status, job }
}

storyboardStep(When, 'the branch is pushed and GitLab runs the publication itself', async () => {
  const rootHeaders = await getRootHeaders()
  const lambdaHeaders = { 'PRIVATE-TOKEN': global.pubLambdaToken }

  // Switched on here, not at the start: the earlier chapters photograph merge
  // request pages, and a pipeline running behind them repaints the merge widget
  // under the camera.
  await updateProjectSettings(global.pubPrivate, { jobs_enabled: true }, lambdaHeaders)

  // What a laptop keeps in .env, CI keeps in its own variables. Not masked here
  // only because this GitLab is thrown away with the scenario; the install story
  // is the one that proves the masking.
  for (const [key, value] of [
    ['TASK_PUBLICATION_TOKEN', global.pubLambdaToken],
    ['TASK_PUBLICATION_SOURCE_TOKEN', global.pubLambdaToken],
    ['TASK_PUBLICATION_TOKEN_USERNAME', lambdaUser()]
  ]) {
    const res = await createProjectVariable(
      global.pubPrivate, { key, value, masked: false, protected: false }, lambdaHeaders
    )
    if (res.status >= 400) {
      throw new Error(`Failed to create ${key}: ${res.status} ${JSON.stringify(res.data)}`)
    }
  }

  await backToTerminal()
  // Where the source goes is not a secret, so it travels in the versioned
  // defaults — which is also how the job finds it, having no task runner to load
  // the dotenv files for it.
  // Filled in, not appended: the file ships both keys empty, and a project fills
  // them in where they already are.
  const targetUrl = `http://gitlab/${lambdaUser()}/${global.pubPublic}.git`
  inProjectOrThrow(
    "sed -i -e 's|^TASK_PUBLICATION_ENABLED=.*|TASK_PUBLICATION_ENABLED=true|' " +
    `-e 's|^TASK_PUBLICATION_TARGET_URL=.*|TASK_PUBLICATION_TARGET_URL=${targetUrl}|' .env.dist`
  )
  const written = inProjectOrThrow('grep TASK_PUBLICATION .env.dist')
  mustContain(written, targetUrl, 'the pipeline reads the destination from the versioned defaults')
  inProjectOrThrow(`cat > .gitlab-ci.yml <<'STORY_CI'\n${STORY_PIPELINE}STORY_CI`)
  inProjectOrThrow('git add .env.dist .gitlab-ci.yml && git commit -q --no-verify -m "ci: let the pipeline publish the source"')

  global.pubRunner = await registerScopedRunner(I, global.pubPrivate, rootHeaders)
  inProjectOrThrow('git push --quiet origin main')

  const { pid, status, job } = await publicationJob(lambdaHeaders)
  global.pubCiPid = pid
  if (status !== 'failed') {
    throw new Error(`The pipeline must refuse to publish an unapproved file, it was "${status}"`)
  }
  await publicationJobCard(job.id, 'publication-ci-refused')

  mustContain(jobTrace(job.id, lambdaHeaders), [LATE_ARRIVAL, 'Nobody has approved that list'],
    'the job must refuse for the same reason, and name the same file')
})

storyboardStep(Then, 'the pipeline publishes the source on its own, once an owner has approved', async () => {
  const lambdaHeaders = { 'PRIVATE-TOKEN': global.pubLambdaToken }
  const ownerHeaders = { 'PRIVATE-TOKEN': global.pubOwnerToken }

  // The owner answers the question on the merge request the refusal left behind,
  // and it goes in. Off camera: chapter 3 is where that page is photographed.
  const mr = await openApprovalMergeRequest(lambdaHeaders)
  const thread = await approvalThread(mr.iid, ownerHeaders)
  await setThreadResolved(mr.iid, thread.id, true, ownerHeaders)
  const merged = await mergeMergeRequest(global.pubPrivate, mr.iid, lambdaHeaders)
  if (merged.status >= 400) {
    throw new Error(`The approval merge request must go in: ${merged.status} ${JSON.stringify(merged.data)}`)
  }

  // No second command anywhere: the merge landed on main, and that is what
  // starts the pipeline again.
  const { status, job } = await publicationJob(lambdaHeaders, global.pubCiPid)
  if (status !== 'success') {
    throw new Error(`The pipeline must publish once an owner approved, it was "${status}"`)
  }
  await publicationJobCard(job.id, 'publication-ci-published')

  mustContain(jobTrace(job.id, lambdaHeaders), ['Publishing 4 files', 'Pushed', OWNER_USERNAME],
    'the job must say what it published and who approved it')
})

storyboardStep(Then, 'the public project carries exactly what the owner approved', async () => {
  await gitlabCard(`/${projectPath(global.pubPublic)}/-/tree/main/src`, 'publication-public-ci', 560)
  const paths = await publicTreePaths()
  if (!paths.includes(LATE_ARRIVAL)) {
    throw new Error(`"${LATE_ARRIVAL}" was approved and must now be public, found ${JSON.stringify(paths)}`)
  }
  for (const withheld of [WITHHELD_BY_FLOOR, WITHHELD_BY_DENYLIST]) {
    if (paths.includes(withheld)) {
      throw new Error(`"${withheld}" must never leave, found in ${JSON.stringify(paths)}`)
    }
  }
})

// ===========================================================================
// @publication-only — the component installed on its own.
//
// The same journey engine as agent mode: a real clone of a real test-GitLab
// project, the REAL working-branch installer, and its live gum checklist caught
// while it is on screen. What this story adds is the proof that the component
// stands alone: it lands in a project with no Taskfile and no `task`, and its
// script still runs there with nothing but a shell and git.
// ===========================================================================

const SCOPE_PROMPT = 'Install the complete DevSecOps framework?'
const CHECKLIST_HEADER = 'Select what to install'
const PUBLICATION_DONE = 'Source publication installed.'
const WIRING_PROMPT = 'Say where the source goes'
const WIRING_DONE = 'nightly schedule'

async function waitInstallerLog (needle, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = execInContainerAsUser(
      global.pubContainer, 'bootstrap', `grep -c ${shellEscape(needle)} ${INSTALL_LOG} 2>/dev/null || true`
    )
    if (parseInt((res.output || '0').trim(), 10) > 0) return
    await I.wait(3)
  }
  throw new Error(`The installer never printed "${needle}" (see ${INSTALL_LOG})`)
}

storyboardStep(Given, 'a project that carries no framework at all', async () => {
  const rootHeaders = await getRootHeaders()
  await GitLabUserPage.ensureUserViaApi(
    BASE_URL, process.env.TASK_GITLAB_ROOT_USER, process.env.TASK_GITLAB_ROOT_PASSWORD,
    {
      email: process.env.TASK_GITLAB_LAMBDA_EMAIL,
      username: lambdaUser(),
      name: 'Lambda User',
      password: process.env.TASK_GITLAB_LAMBDA_PASSWORD
    }
  )
  const suffix = crypto.randomBytes(4).toString('hex')
  global.pubPrivate = `e2e-journey-${suffix}`
  global.pubLambdaToken = await personalAccessTokenFor(lambdaUser(), `publication-only-${suffix}`, rootHeaders)
  const created = await createProject(
    { name: global.pubPrivate, visibility: 'public', initialize_with_readme: true },
    { 'PRIVATE-TOKEN': global.pubLambdaToken }
  )
  if (created.status >= 400) {
    throw new Error(`Failed to create the project: ${created.status} ${JSON.stringify(created.data)}`)
  }
  // Where the source will go. Empty, and never touched by this story: what the
  // install has to prove is that the project can be TOLD where to publish, not
  // that it publishes — that is the daily-work story's job.
  global.pubPublic = `${global.pubPrivate}-public`
  const createdPublic = await createProject(
    { name: global.pubPublic, visibility: 'public' },
    { 'PRIVATE-TOKEN': global.pubLambdaToken }
  )
  if (createdPublic.status >= 400) {
    throw new Error(`Failed to create the public project: ${createdPublic.status} ${JSON.stringify(createdPublic.data)}`)
  }

  global.pubContainer = setupClonedProjectTerminal(global.pubPrivate, global.pubLambdaToken)
  prepareWorkingBranchInstaller(global.pubContainer)
  // The staged template becomes a RELEASED one: copier records the tag it
  // rendered from in the answers file, and that recorded release is what makes
  // the component updatable later. A plain directory would record nothing.
  const released = execInContainerAsUser(global.pubContainer, 'bootstrap', [
    'set -e',
    'cd /tmp/toolbox-template',
    'git init -q -b main .',
    'git config user.email "e2e@test.local" && git config user.name "E2E"',
    'git add -A',
    'git commit -q --no-verify -m "chore: toolbox release 1.0.0"',
    'git tag 1.0.0'
  ].join('\n'), { timeout: 300000 })
  if (released.exitCode !== 0) {
    throw new Error(`Failed to tag the staged template as a release:\n${released.output}`)
  }
  // The toolchain download is volatile output; it happens off camera so the
  // first frame can start on the empty project instead of on a wall of progress.
  preinstallToolchain(global.pubContainer)

  I.amOnPage(`http://${global.pubContainer}:${ttydPort()}`) // DevSkim: ignore DS162092
  I.waitForElement('.xterm-screen', 10)
  await I.wait(3)
  await typeCommandAndWait(I, 'clear')
  const screen = await terminalCard('ls -A1 && git status --short', 'ls -A1', 'publication-only-before')
  mustContain(screen, 'README.md', 'the project starts with its README and nothing else')
})

storyboardStep(When, 'the developer ticks source publication on the checklist', async () => {
  I.click('.xterm-screen')
  I.type(`bash ${WRAPPER_PATH}`)
  I.pressKey('Enter')
  await waitForTerminalText(I, SCOPE_PROMPT, COMMAND_TIMEOUT_MS)
  await waitForTerminalSettle(I)
  // Move onto "Choose components" and submit it: the checklist opens.
  I.pressKey('ArrowRight')
  await waitForTerminalSettle(I)
  I.pressKey('Enter')
  await waitForTerminalText(I, CHECKLIST_HEADER, COMMAND_TIMEOUT_MS)
  await waitForTerminalSettle(I)
  // The AI agent line opens ticked. Tick source publication, untick the other,
  // and photograph the checklist while it is still on screen — it erases itself
  // the instant the answer is given.
  I.pressKey('ArrowDown')
  I.pressKey('Space')
  await waitForTerminalSettle(I)
  I.pressKey('ArrowUp')
  I.pressKey('Space')
  await waitForTerminalSettle(I)
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'publication-only-checklist', {
    fromMarker: CHECKLIST_HEADER, mask: TERMINAL_MASKS
  }))
  I.pressKey('Enter')
})

// The installer's last act, and the only one that needs a forge: it asks where
// the source goes and for the two tokens that get it there, then does the whole
// GitLab side with them. The tokens are typed into a terminal with echo off, so
// this card can be a picture of the real thing without a secret in it.
storyboardStep(When, 'the developer says where the source goes and hands over the tokens', async () => {
  await waitForTerminalText(I, WIRING_PROMPT, COMMAND_TIMEOUT_MS)
  await waitForTerminalSettle(I)
  I.pressKey('Enter')

  await waitForTerminalText(I, 'Your token for THIS repository', COMMAND_TIMEOUT_MS)
  I.type(global.pubLambdaToken)
  I.pressKey('Enter')

  await waitForTerminalText(I, 'The PUBLIC repository', COMMAND_TIMEOUT_MS)
  I.type(`http://gitlab/${lambdaUser()}/${global.pubPublic}.git`)
  I.pressKey('Enter')

  await waitForTerminalText(I, 'A token that may push to it', COMMAND_TIMEOUT_MS)
  I.type(global.pubLambdaToken)
  I.pressKey('Enter')

  await waitInstallerLog(WIRING_DONE)
  await waitForTerminalSettle(I)
  const screen = await terminalText()
  mustContain(screen, ['TASK_RENOVATE_TOKEN created', 'nightly schedule'],
    'the install must do the GitLab side, not just ask about it')
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'publication-only-wiring', {
    fromMarker: 'This repository needs to be told', mask: TERMINAL_MASKS
  }))
})

storyboardStep(Then, 'the project holds the publication component and the spine that carries it', async () => {
  await waitInstallerLog(PUBLICATION_DONE)
  await waitForTerminalSettle(I)
  await typeCommandAndWait(I, 'clear')
  await terminalCard('ls -A1 && ls .config', 'ls -A1', 'publication-only-installed')

  const entries = stripAnsiEscapeSequences(
    inProjectOrThrow("ls -A1 | grep -v '^.git$' | sort")
  ).split('\n').map(l => l.trim()).filter(Boolean).sort()
  const expected = ['.config', '.env.dist', '.gitlab-ci.yml', 'README.md', 'Taskfile.yml'].sort()
  if (JSON.stringify(entries) !== JSON.stringify(expected)) {
    throw new Error(`The project must hold exactly ${JSON.stringify(expected)} (plus .git), found ${JSON.stringify(entries)}`)
  }
  const component = stripAnsiEscapeSequences(inProjectOrThrow('ls -A1 .config/publication | sort'))
  for (const file of ['allowlist', 'denylist', 'denylist.base', 'manifest', 'owners', 'publish.sh']) {
    mustContain(component, file, 'the component must arrive whole')
  }
  // The spine, and not one tool: what makes the component updatable is here,
  // what would make it a full install is not.
  const config = stripAnsiEscapeSequences(inProjectOrThrow('ls -A1 .config | sort'))
  mustContain(config, ['copier', 'devsecops', 'publication', 'python', 'renovate'],
    'the update spine must travel with the component')
  mustNotContain(config, ['megalinter', 'docker', 'glab', 'codeceptjs'],
    'a component-only install must bring no tooling')
})

/**
 * The CI/CD settings page opens with every section folded, so a plain capture
 * photographs a table of contents. Open the one this card is about, the way a
 * reader clicks it, and frame the variables themselves.
 */
async function variablesCard () {
  I.resizeWindow(1024, 430)
  await I.amOnPage(`/${projectPath(global.pubPrivate)}/-/settings/ci_cd`)
  await I.waitForElement('body', 30)
  await I.executeScript(() => {
    const heading = Array.from(document.querySelectorAll('h2, h4'))
      .find(h => h.textContent.trim() === 'Variables')
    if (!heading) return
    const section = heading.closest('section') || heading.parentElement
    const toggle = section && section.querySelector('button')
    if (toggle) toggle.click()
  })
  await I.waitForElement('[data-testid="ci-variable-table"]', 30)
  await I.wait(2)
  // The table sits well below the section's own settings, so the heading is the
  // wrong anchor: scroll to the variables themselves, and a little above them so
  // their own title comes into frame.
  await I.executeScript(() => {
    const table = document.querySelector('[data-testid="ci-variable-table"]')
    if (table) {
      table.scrollIntoView({ block: 'start' })
      window.scrollBy(0, -90)
    }
  })
  await I.wait(1)
  await GitLabRepositoryPage.maskVolatile(global.pubPrivate)
  await settlePageChrome()
  await addStoryboardFrame(I, await capturePageFrame(I, 'publication-only-variables'))
  I.resizeWindow(1024, 768)
}

storyboardStep(Then, 'GitLab holds the tokens, masked and protected', async () => {
  // The settings the install just wrote are private to the project: an anonymous
  // browser is answered with a 404, not with a sign-in page. The developer who
  // ran the installer is the one who gets to look.
  await GitLabUserPage.loginAs(lambdaUser(), process.env.TASK_GITLAB_LAMBDA_PASSWORD)
  const headers = { 'PRIVATE-TOKEN': global.pubLambdaToken }
  for (const name of ['TASK_PUBLICATION_TOKEN', 'TASK_RENOVATE_TOKEN', 'TASK_PUBLICATION_SOURCE_TOKEN']) {
    const variable = await readProjectVariable(global.pubPrivate, name, headers)
    if (variable.status >= 400) {
      throw new Error(`${name} must exist as a CI/CD variable, got ${variable.status}`)
    }
    if (variable.data.masked !== true || variable.data.protected !== true) {
      throw new Error(`${name} must be masked and protected, got ${JSON.stringify(variable.data)}`)
    }
  }
  // The project token is the one the install created, so that no human's own
  // token ever has to be handed to CI.
  const tokens = await listProjectAccessTokens(global.pubPrivate, headers)
  const renovateToken = (tokens.data || []).find(t => t.name === 'TASK_RENOVATE_TOKEN' && !t.revoked)
  if (!renovateToken) {
    throw new Error(`No project access token named TASK_RENOVATE_TOKEN: ${JSON.stringify(tokens.data)}`)
  }
  if (renovateToken.access_level !== 40 || !(renovateToken.scopes || []).includes('api')) {
    throw new Error(`The Renovate token must be api/Maintainer, got ${JSON.stringify(renovateToken)}`)
  }
  await variablesCard()
})

storyboardStep(Then, 'a nightly check will bring the next toolbox release in', async () => {
  const schedules = await listPipelineSchedules(global.pubPrivate, { 'PRIVATE-TOKEN': global.pubLambdaToken })
  const nightly = (schedules.data || []).find(s => s.description.startsWith('Source publication'))
  if (!nightly) {
    throw new Error(`No pipeline schedule was created: ${JSON.stringify(schedules.data)}`)
  }
  if (nightly.ref !== 'main' && nightly.ref !== 'refs/heads/main') {
    throw new Error(`The schedule must run on main, got ${nightly.ref}`)
  }
  await gitlabCard(`/${projectPath(global.pubPrivate)}/-/pipeline_schedules`, 'publication-only-schedule', 330)
})

storyboardStep(Then, 'it runs, and says what would become public', async () => {
  // Cleared first: the installer's own hint above prints the very command this
  // card is about, and an anchor that appears twice frames the wrong one.
  await backToTerminal()
  const screen = await terminalCard('task publication:check', 'task publication:check', 'publication-only-check')
  mustContain(screen, ['Source publication', 'README.md', 'no approved list yet'],
    'the component must answer on its own, with no framework around it')
})

storyboardStep(Then, 'it records the toolbox release it came from', async () => {
  await typeCommandAndWait(I, 'clear')
  const screen = await terminalCard(
    'grep _commit .config/devsecops/.copier-answers.yml',
    'grep _commit',
    'publication-only-release'
  )
  mustContain(screen, '_commit:', 'the project must record the release that rendered it')
})
