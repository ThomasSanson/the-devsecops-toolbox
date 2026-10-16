/* global inject Before After Given When Then */
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
 *   - a project-scoped runner runs the REAL pipeline the component ships, and
 *     every card is a GitLab page or job log a reviewer can open;
 *   - the approval merge request is the one the toolbox itself opens, and its
 *     thread is answered through the API by two DIFFERENT real users, so the
 *     "who signed off" check is exercised both ways.
 *
 * Every card is twinned with a REST check of the same fact (the job's trace,
 * the files and commits GitLab holds), so a regression fails loud even without
 * eyes. @publication-only, the component installed on its own, lives at the
 * end of this file.
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execSync, spawnSync } = require('child_process')
const { I, GitLabUserPage } = inject()
const {
  shellEscape,
  execInContainerAsUser,
  stripAnsiEscapeSequences
} = require('../helpers/docker')
const {
  BASE_URL,
  encodedProjectPath,
  getRootHeaders,
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
  getPipeline,
  triggerProjectPipeline,
  getJobTrace,
  getRepositoryFile,
  listCommits
} = require('../helpers/gitlabApi')
const { freshGet, freshPost, freshPut } = require('../helpers/http')
const { gitlabUrl, gitlabFrame, jobLogFrame, unfoldFileTree } = require('../helpers/gitlabCard')
const { screenText, maskText, terminalOutputFrame } = require('../helpers/terminalRender')
const {
  registerScopedRunner,
  teardownScopedRunner,
  cancelRedundantPipelines,
  PIPELINE_TIMEOUT_MS
} = require('../helpers/pipelineRunner')
const { COPIER, renderProject, removeRendered } = require('../helpers/copierRender')
const {
  PROJECT_DIR,
  TEMPLATE_DIR,
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
  addStoryboardFrame
} = require('../../../../../.config/codeceptjs/storyboard')

// The scanner the publication runs before anything leaves. Installed as a binary
// rather than reached through docker: the journey container is a developer's
// machine, and this is the shape that machine has — publish.sh prefers a binary
// and falls back to the image, so the local path is the one this story proves.

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
// The file the manifest lives in, as the merge request shows it.
const MANIFEST_PATH = '.config/publication/manifest'
// Chapter 5: credentials a developer would plausibly paste into a service file,
// in the file that has been published since the first release. Nothing here is a
// real secret; what matters is that a scanner recognises the shape.
const LEAKED_FILE = 'src/app.js'
const LEAKED_SECRET = [
  "const { serve } = require('./server/http')",
  '',
  '// Temporary: staging mailer credentials, to be moved to the vault.',
  'const mailer = {',
  "  host: 'smtp.internal',",
  "  user: 'reporting-bot',",
  // No shell metacharacter in it: a "$" would arrive expanded through some of
  // the layers this travels, leaving a shorter, harmless string and a scan that
  // finds nothing.
  "  password: 'Zt7kQ2mV9pL4xR8w'",
  '}',
  '',
  'serve(process.env.PORT || 8080, mailer)',
  ''
].join('\n')
// The value itself, read back from the line above rather than written twice.
const LEAKED_PASSWORD = LEAKED_SECRET.match(/password: '([^']+)'/)[1]

// The one line the installer writes into a project that has no pipeline. The
// feedback job travels in the same shipped file and is switched off here: it
// runs Renovate, which is the update story's subject, and waiting on it would
// only make these cards slower.
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

// What the terminal really prints but the cards must not embed:
//   - the per-run project name (a fresh random suffix on every run);
//   - the number of framework files outside the allowlist, which moves with
//     every template change.
// Masked at capture time, so the row keeps its colours and its place.
const TERMINAL_MASKS = [
  [/e2e-journey-[0-9a-f]+/g, 'project'],
  [/\b\d+ other tracked files\b/g, '<n> other tracked files'],
  // The commit the publication reads its files from: a new one every run, and
  // the card is about which ref was published, not about which commit that ref
  // happened to be at.
  [/\(([0-9a-f]{7,40})\)/g, '(<sha>)']
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
  global.pubExistingFiles = null
  global.pubExistingProject = null
})

After(async () => {
  // A later scenario can start while these API deletions are pending. Capture
  // this scenario's resources before the first await, and never read or clear
  // its successor's globals from the asynchronous cleanup.
  const resources = {
    container: global.pubContainer,
    runner: global.pubRunner,
    rendered: global.pubRendered,
    projects: [global.pubPrivate, global.pubPublic],
    tokens: [...(global.pubTokens || [])]
  }
  global.pubContainer = null
  global.pubRunner = null
  global.pubRendered = null
  global.pubPrivate = null
  global.pubPublic = null
  global.pubTokens = []

  teardownJourneyTerminal(resources.container)

  // Surgical: only this scenario's runner, so a full local run does not pull the
  // rug from under the other stories sharing the gitlab-runner service.
  if (resources.runner) {
    try {
      await teardownScopedRunner(resources.runner)
    } catch (_) {
      // Best-effort: the project is deleted just below anyway.
    }
  }

  removeRendered(resources.rendered)

  // Scenarios without publication resources need no GitLab credential.
  if (!resources.projects.some(Boolean) && resources.tokens.length === 0) return

  let rootHeaders = null
  try {
    rootHeaders = await getRootHeaders()
  } catch (_) {
    return
  }

  for (const name of resources.projects) {
    if (!name) continue
    try {
      await deleteProject(name, rootHeaders)
    } catch (_) {
      // Best-effort: GitLab deletion is async and non-critical.
    }
  }

  for (const id of resources.tokens) {
    try {
      await revokePersonalAccessToken(id, rootHeaders)
    } catch (_) {
      // Best-effort: per-scenario tokens must not pile up on the GitLab volume.
    }
  }
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

/**
 * GitLab writes some of a merge request's activity in the background (the
 * "mentioned in commit" a merge leaves, for one). A card of that activity waits
 * on the API until the line it must show exists, `count` times.
 */
async function waitSystemNotes (iid, headers, body, count = 1) {
  const url = `${BASE_URL}/api/v4/projects/${encodedProjectPath(global.pubPrivate)}/merge_requests/${iid}/notes?per_page=100`
  let found = 0
  for (let attempt = 0; attempt < 30; attempt++) {
    const res = await freshGet(url, headers)
    found = (res.data || []).filter(n => n.system && n.body.startsWith(body)).length
    if (found >= count) return
    await I.wait(2)
  }
  throw new Error(`!${iid} shows ${found} "${body}" note(s), expected ${count}`)
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
  const url = sourceUrl(token)
  sh('git init --quiet --initial-branch=main', root)
  sh('git config user.email "lambda@test.local" && git config user.name "Lambda User"', root)
  sh('git add -A', root)
  sh('git commit --quiet --no-verify -m "feat: the field reporting service"', root)
  sh(`git tag ${FIXTURE_TAG}`, root)
  sh(`git push --quiet ${shellEscape(url)} main --tags`, root)
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

/** Run a git command in the rendered tree that IS the private project. */
function inSource (cmd) {
  return sh(cmd, global.pubRendered)
}

function sourceUrl (token) {
  const url = new URL(`/${lambdaUser()}/${global.pubPrivate}.git`, BASE_URL)
  url.username = lambdaUser()
  url.password = token
  return url.href
}

/**
 * Bring the tree back in step with GitLab before committing on top of it: the
 * approval merge request went in on the forge, so main is a merge commit ahead
 * of this copy and a push would be rejected.
 */
function syncSource (token) {
  sh(`git fetch --quiet ${shellEscape(sourceUrl(token))} main`, global.pubRendered)
  sh('git reset --hard --quiet FETCH_HEAD', global.pubRendered)
}

/** Push it, with the token in the URL and nowhere else. */
function pushSource (token) {
  sh(`git push --quiet ${shellEscape(sourceUrl(token))} main`, global.pubRendered)
}

/**
 * The named job of the newest pipeline on main, whatever its verdict. `after` is
 * the pipeline this story already read: every chapter here starts one, so the
 * wait has to be for a NEW pipeline rather than for a terminal state the
 * previous one already has.
 */
async function publicationJob (headers, after = 0, jobName = 'publish-source') {
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
    // A merge request pipeline runs the same two jobs on the approval branch.
    // On a single-slot runner it would run ahead of the one this story waits
    // for, so it goes as soon as that one exists.
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
  const job = (jobs.data || []).find(j => j.name === jobName)
  if (!job) {
    throw new Error(`Pipeline ${pid} carried no ${jobName} job: ${JSON.stringify((jobs.data || []).map(j => j.name))}`)
  }
  if (!['success', 'failed'].includes(job.status)) {
    for (const other of (jobs.data || []).filter(j => j.name !== jobName)) {
      console.log(`── ${other.name}: ${other.status}\n${await getJobTrace(global.pubPrivate, other.id, headers)}`)
    }
    throw new Error(`${jobName} is "${job.status}" — it never ran; the traces above say why.`)
  }
  return { pid, status, job, jobs: jobs.data }
}

// What this story's GitLab pages show that moves between two runs and is not
// what a card is about, on top of what every GitLab card masks: the sidebar
// counters and the pipeline icon of the last commit (the story's own pipelines
// open and merge requests and fail while the cards are taken), the statistics
// and the language bar GitLab recomputes after a push, and the pipeline a merge
// starts under the merged widget.
const PAGE_HIDE = [
  '#super-sidebar [data-testid="pill-badge"]',
  '[data-testid="ci-icon"]',
  '.project-page-sidebar-block:has(> .project-stats)',
  '[data-testid="repository-language-bar"]',
  '[class*="repository-language"]',
  '[data-testid="merged-pipeline-container"]'
]

/**
 * A page of the private project, or of the public one: both are masked on the
 * private project's random name, so they read "project" and "project-public".
 */
async function storyFrame (frameName, url, opts = {}) {
  await gitlabFrame(I, frameName, url, { projectNames: [global.pubPrivate], hide: PAGE_HIDE, ...opts })
}

// The page-side twin of waitSystemNotes: the merge request page shows `count`
// activity lines carrying `text`.
function activityShows (text, count = 1) {
  // waitForFunction hands its argument array over as ONE argument.
  return I.waitForFunction(([t, n]) => Array.from(document.querySelectorAll('.system-note'))
    .filter(note => note.textContent.includes(t)).length >= n, [text, count], 30)
}

// Every merge request card is the same page at the same size, so the two cards
// of chapter 3 read as before and after: only the name on the thread changes.
const MR_HEIGHT = 1100

// What a job log prints that is never the same twice, on top of the shared job
// masks: the short commit the publication reads (seven characters, below the
// shared SHA mask), the scanner's own clock and duration, and the scanner's
// version, since its image is :latest.
const JOB_MASKS = [
  [/\(([0-9a-f]{7,40})\)/g, '(<sha>)'],
  [/\d{1,2}:\d{2}(AM|PM)/g, '<time>'],
  [/in [\d.]+(ns|µs|us|ms|s)\b/g, 'in <ms>'],
  [/betterleaks \d+\.\d+\.\d+/g, 'betterleaks <version>']
]

/** A job page, its log from the task the job runs down: the runner's setup is scrolled past. */
async function publicationJobFrame (frameName, jobId, task, height = 600) {
  await jobLogFrame(I, frameName, global.pubPrivate, jobId, {
    from: `$ task ${task}`,
    waitText: 'Source publication',
    masks: JOB_MASKS,
    height
  })
}

const lambdaHeaders = () => ({ 'PRIVATE-TOKEN': global.pubLambdaToken })

// ===========================================================================
// Chapter 1 — What would leave the private project
//
// The whole story is told on GitLab, because that is where a team lives it:
// pages a reviewer can open and job logs they can read. A project-scoped runner
// runs the real pipeline, and every state change here is a push or an answer on
// a merge request, never a command somebody types on a laptop.
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

  for (const [name, visibility] of [[global.pubPrivate, 'private'], [global.pubPublic, 'public']]) {
    const created = await createProject(
      { name, visibility, initialize_with_readme: false },
      lambdaHeaders()
    )
    if (created.status >= 400 || created.data.visibility !== visibility) {
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
    { only_allow_merge_if_all_discussions_are_resolved: true },
    lambdaHeaders()
  )

  // What a laptop keeps in .env, CI keeps in its own variables. Not masked here
  // only because this GitLab is thrown away with the scenario; the install story
  // is the one that proves the masking.
  for (const [key, value] of [
    ['TASK_PUBLICATION_TOKEN', global.pubLambdaToken],
    ['TASK_PUBLICATION_SOURCE_TOKEN', global.pubLambdaToken],
    ['TASK_PUBLICATION_TOKEN_USERNAME', lambdaUser()]
  ]) {
    const res = await createProjectVariable(
      global.pubPrivate, { key, value, masked: false, protected: false }, lambdaHeaders()
    )
    if (res.status >= 400) {
      throw new Error(`Failed to create ${key}: ${res.status} ${JSON.stringify(res.data)}`)
    }
  }

  global.pubRendered = buildPrivateProjectTree()
  // The pipeline the component ships, included the way the installer writes it,
  // and the destination in the versioned defaults where a project keeps it.
  writeFixtureFile(global.pubRendered, '.gitlab-ci.yml', STORY_PIPELINE)
  const envPath = `${global.pubRendered}/.env.dist`
  fs.writeFileSync(envPath, fs.readFileSync(envPath, 'utf8')
    .replace(/^TASK_PUBLICATION_ENABLED=.*$/m, 'TASK_PUBLICATION_ENABLED=true')
    .replace(/^TASK_PUBLICATION_TARGET_URL=.*$/m,
      `TASK_PUBLICATION_TARGET_URL=${new URL(`/${lambdaUser()}/${global.pubPublic}.git`, BASE_URL).href}`))

  // The runner comes first: the push below starts the pipeline this chapter is
  // about, and a pipeline with nobody to run it would sit pending for ever.
  global.pubRunner = await registerScopedRunner(I, global.pubPrivate, rootHeaders)
  pushPrivateProject(global.pubRendered, global.pubLambdaToken)

  // The project is private: an anonymous browser is answered with the sign-in
  // form, and every GitLab card in this story would photograph that instead of
  // the product. Sign in once, as the developer whose project this is.
  await GitLabUserPage.loginAs(lambdaUser(), process.env.TASK_GITLAB_LAMBDA_PASSWORD)

  // The overview: the padlock beside the name, and the root listing where src/
  // sits next to deploy/ and the framework's own files.
  await storyFrame('publication-private-before', gitlabUrl.project(global.pubPrivate), {
    waitText: 'Field Reporting', height: 1100
  })

  // The private project really holds the files the story reasons about: a read
  // of a missing one throws.
  for (const file of [...PUBLISHED, WITHHELD_BY_FLOOR, WITHHELD_BY_DENYLIST, NEVER_ALLOWED]) {
    await getRepositoryFile(global.pubPrivate, file, 'main', lambdaHeaders())
  }
})

const LIST_HEIGHT = 760

storyboardStep(When, 'a reviewer opens the file that says what may be published', async () => {
  const file = '.config/publication/allowlist'
  await storyFrame('publication-allowlist', gitlabUrl.file(global.pubPrivate, 'main', file), {
    waitText: '/src/**', height: LIST_HEIGHT
  })
  mustContain(await getRepositoryFile(global.pubPrivate, file, 'main', lambdaHeaders()),
    ['/README.md', '/src/**'], 'the allowlist must name the README and src/')
})

storyboardStep(When, 'the file that takes files back out of it, which always wins', async () => {
  const file = '.config/publication/denylist'
  await storyFrame('publication-denylist', gitlabUrl.file(global.pubPrivate, 'main', file), {
    waitText: 'src/internal/', height: LIST_HEIGHT
  })
  mustContain(await getRepositoryFile(global.pubPrivate, file, 'main', lambdaHeaders()),
    'src/internal/', 'the denylist must take the internal folder back out')
})

// ===========================================================================
// Chapter 2 — Nothing leaves until somebody has said yes
// ===========================================================================

storyboardStep(Then, 'the pipeline refuses to publish a list nobody approved', async () => {
  const { pid, status, job } = await publicationJob(lambdaHeaders())
  global.pubCiPid = pid
  if (status !== 'failed') {
    throw new Error(`The pipeline must refuse a list nobody approved, it was "${status}"`)
  }
  mustContain(await getJobTrace(global.pubPrivate, job.id, lambdaHeaders()),
    [...PUBLISHED, 'would become public for the first time', 'Nobody has approved that list'],
    'the job must name every path it refuses to publish')
  await publicationJobFrame('publication-ci-unapproved', job.id, 'publication:publish')
})

storyboardStep(Then, 'the public project is still empty', async () => {
  await storyFrame('publication-public-empty', gitlabUrl.project(global.pubPublic), {
    waitText: 'The repository for this project is empty', height: 700
  })
  const paths = await publicTreePaths()
  if (paths.length !== 0) {
    throw new Error(`The public project must still be empty, it holds ${JSON.stringify(paths)}`)
  }
})

storyboardStep(Then, 'the job opens a merge request asking the owners to approve the list', async () => {
  const mr = await openApprovalMergeRequest(lambdaHeaders())
  global.pubMrIid = mr.iid
  const thread = await approvalThread(mr.iid, lambdaHeaders())
  const asked = (thread.notes || []).find(n => !n.system)
  mustContain(asked.body, 'Resolve this thread', 'the toolbox must leave a question, not a note')
  mustContain(mr.description, OWNER_USERNAME, 'the merge request must name the owners it is asking')

  await storyFrame('publication-approval-mr', gitlabUrl.mr(global.pubPrivate, mr.iid), {
    waitText: 'Merge blocked',
    height: MR_HEIGHT,
    prepare: () => I.waitForText('Publication-manifest', 30)
  })
})

storyboardStep(Then, 'that merge request shows the exact list of paths that would become public', async () => {
  const changes = await waitMrChanges(global.pubMrIid, lambdaHeaders(), MANIFEST_PATH)
  const manifest = changes.find(c => c.new_path === MANIFEST_PATH)
  for (const path of PUBLISHED) {
    if (!manifest.diff.includes(`+${path}`)) {
      throw new Error(`The manifest diff must add "${path}":\n${manifest.diff}`)
    }
  }
  await storyFrame('publication-approval-diff', gitlabUrl.mr(global.pubPrivate, global.pubMrIid, 'diffs'), {
    waitText: 'src/server/http.js', height: 480
  })
})

// ===========================================================================
// Chapter 3 — The right person has to be the one who says yes
// ===========================================================================

storyboardStep(When, 'the developer answers the question themselves and merges it', async () => {
  const blocked = await mergeMergeRequest(global.pubPrivate, global.pubMrIid, lambdaHeaders())
  if (blocked.status < 400) {
    throw new Error('GitLab must refuse the merge while the thread is open')
  }

  const thread = await approvalThread(global.pubMrIid, lambdaHeaders())
  await setThreadResolved(global.pubMrIid, thread.id, true, lambdaHeaders())
  const merged = await mergeMergeRequest(global.pubPrivate, global.pubMrIid, lambdaHeaders())
  if (merged.status >= 400) {
    throw new Error(`The merge must go through once the thread is answered: ${merged.status} ${JSON.stringify(merged.data)}`)
  }
  const answered = await approvalThread(global.pubMrIid, lambdaHeaders())
  const signer = (answered.notes || []).find(n => n.resolved_by)
  if (!signer || signer.resolved_by.username !== lambdaUser()) {
    throw new Error(`The thread must be resolved by ${lambdaUser()}, got ${JSON.stringify(signer && signer.resolved_by)}`)
  }

  // GitLab marks the MR merged before its background worker deletes the source
  // branch, and writes "mentioned in commit" after it. Wait for both before the
  // card, which shows the merge widget and the activity under it.
  const sourceBranch = merged.data && merged.data.source_branch
  if (typeof sourceBranch !== 'string' || !sourceBranch) {
    throw new Error('The merged response must identify the source branch to verify its deletion')
  }
  const branchUrl = `${BASE_URL}/api/v4/projects/${encodedProjectPath(global.pubPrivate)}` +
    `/repository/branches/${encodeURIComponent(sourceBranch)}`
  let deleted = false
  for (let attempt = 0; attempt < 30; attempt++) {
    const branch = await freshGet(branchUrl, lambdaHeaders())
    if (branch.status === 404) {
      deleted = true
      break
    }
    if (branch.status !== 200 || !branch.data || branch.data.name !== sourceBranch) {
      throw new Error(`Cannot verify deletion of "${sourceBranch}": HTTP ${branch.status} ${JSON.stringify(branch.data)}`)
    }
    if (attempt < 29) await I.wait(2)
  }
  if (!deleted) throw new Error(`Source branch "${sourceBranch}" was not deleted after 30 checks`)
  await waitSystemNotes(global.pubMrIid, lambdaHeaders(), 'mentioned in commit')

  await storyFrame('publication-mr-merged', gitlabUrl.mr(global.pubPrivate, global.pubMrIid), {
    waitText: 'Merged by', height: MR_HEIGHT, prepare: () => activityShows('mentioned in commit')
  })
})

storyboardStep(Then, 'the pipeline still refuses, and names the person who answered', async () => {
  const { pid, status, job } = await publicationJob(lambdaHeaders(), global.pubCiPid)
  global.pubCiPid = pid
  if (status !== 'failed') {
    throw new Error(`The pipeline must refuse a list no owner signed, it was "${status}"`)
  }
  mustContain(await getJobTrace(global.pubPrivate, job.id, lambdaHeaders()), [lambdaUser(), 'not an owner', OWNER_USERNAME],
    'the job must name who answered and who should have')
  await publicationJobFrame('publication-ci-wrong-signer', job.id, 'publication:publish')
})

storyboardStep(When, 'an owner reopens the question and answers it instead', async () => {
  const ownerHeaders = { 'PRIVATE-TOKEN': global.pubOwnerToken }
  const thread = await approvalThread(global.pubMrIid, ownerHeaders)
  await setThreadResolved(global.pubMrIid, thread.id, false, ownerHeaders)
  await setThreadResolved(global.pubMrIid, thread.id, true, ownerHeaders)

  const answered = await approvalThread(global.pubMrIid, ownerHeaders)
  const signer = (answered.notes || []).find(n => n.resolved_by)
  if (!signer || signer.resolved_by.username !== OWNER_USERNAME) {
    throw new Error(`The thread must now be resolved by ${OWNER_USERNAME}, got ${JSON.stringify(signer && signer.resolved_by)}`)
  }
  // The owner's answer leaves its own "resolved all threads" under the first one.
  await waitSystemNotes(global.pubMrIid, lambdaHeaders(), 'resolved all threads', 2)
  await storyFrame('publication-owner-answered', gitlabUrl.mr(global.pubPrivate, global.pubMrIid), {
    waitText: 'Merged by', height: MR_HEIGHT, prepare: () => activityShows('resolved all threads', 2)
  })
})

storyboardStep(Then, 'the pipeline publishes the approved files, and only them', async () => {
  // The approval changed on a merge request that is already in, so nothing
  // pushed: the pipeline is asked to run again on the same commit.
  const started = await triggerProjectPipeline(global.pubPrivate, 'main', lambdaHeaders())
  if (started.status >= 400) {
    throw new Error(`Failed to run the pipeline again: ${started.status} ${JSON.stringify(started.data)}`)
  }
  const { pid, status, job } = await publicationJob(lambdaHeaders(), global.pubCiPid)
  global.pubCiPid = pid
  if (status !== 'success') {
    throw new Error(`The pipeline must publish once an owner approved, it was "${status}"`)
  }
  mustContain(await getJobTrace(global.pubPrivate, job.id, lambdaHeaders()), [OWNER_USERNAME, 'Publishing 3 files', 'Pushed'],
    'the job must say what it published and who approved it')
  await publicationJobFrame('publication-ci-published', job.id, 'publication:publish')
})

storyboardStep(Then, 'the public project now carries README.md and src/, without the folders that never leave', async () => {
  // The Files panel unfolded down to the last published file: the whole public
  // tree in one picture, and nothing of what stayed behind.
  await storyFrame('publication-public-after', gitlabUrl.tree(global.pubPublic), {
    waitText: 'publish 1.4.0', height: 640, prepare: () => unfoldFileTree(I, ['src', 'server'])
  })
  await assertPublicProjectHolds(PUBLISHED, 'The public project must carry exactly the approved files')
  const paths = await publicTreePaths()
  for (const withheld of [WITHHELD_BY_FLOOR, WITHHELD_BY_DENYLIST, NEVER_ALLOWED]) {
    if (paths.includes(withheld)) {
      throw new Error(`"${withheld}" must never have left the private project`)
    }
  }
})

storyboardStep(Then, 'the published history is one commit for that release', async () => {
  await storyFrame('publication-public-history', gitlabUrl.commits(global.pubPublic), {
    waitText: 'publish 1.4.0', height: 400
  })
  const commits = await listCommits(global.pubPublic, 'main', await getRootHeaders())
  if (commits.length !== 1) {
    throw new Error(`The public history must hold exactly one commit, found ${commits.length}`)
  }
  mustContain(commits[0].message, global.pubPrivate,
    'the publication commit must name the project it came from')
})

// ===========================================================================
// Chapter 4 — Later changes do not slip through
//
// The approval answers "may this file be public". It cannot answer "is there a
// secret in it", because the file was approved long before the line was written.
// So the pipeline reads what would become public and scans it, and the
// publication waits on that answer.
// ===========================================================================

storyboardStep(When, 'a developer pushes a new file into a published folder, and the pipeline asks the owners again', async () => {
  syncSource(global.pubLambdaToken)
  writeFixtureFile(global.pubRendered, LATE_ARRIVAL, 'exports.store = new Map()\n')
  inSource(`git add ${LATE_ARRIVAL}`)
  inSource('git commit --quiet --no-verify -m "feat: remember the tokens between requests"')
  pushSource(global.pubLambdaToken)

  const { pid, status, job } = await publicationJob(lambdaHeaders(), global.pubCiPid)
  global.pubCiPid = pid
  if (status !== 'failed') {
    throw new Error(`The pipeline must refuse a file nobody approved, it was "${status}"`)
  }
  mustContain(await getJobTrace(global.pubPrivate, job.id, lambdaHeaders()),
    [LATE_ARRIVAL, 'would become public for the first time', 'Merge request !2'],
    'the job must name the file that landed in an already-published folder')
  await publicationJobFrame('publication-ci-late-arrival', job.id, 'publication:publish')
})

storyboardStep(When, 'a secret committed into a published file is stopped by the scan before the publication starts, and its log prints REDACTED instead of the password', async () => {
  syncSource(global.pubLambdaToken)
  writeFixtureFile(global.pubRendered, LEAKED_FILE, LEAKED_SECRET)
  inSource(`git add ${LEAKED_FILE}`)
  inSource('git commit --quiet --no-verify -m "feat: send the daily report by mail"')
  pushSource(global.pubLambdaToken)

  const { pid, status, job, jobs } = await publicationJob(lambdaHeaders(), global.pubCiPid, 'publication:scan')
  global.pubCiPid = pid
  const trace = await getJobTrace(global.pubPrivate, job.id, lambdaHeaders())
  if (status !== 'failed') {
    console.log(`── publication:scan (${job.status})\n${trace}`)
    throw new Error(`The pipeline must stop on the secret, it was "${status}"`)
  }
  mustContain(trace, [LEAKED_FILE, 'generic-password'], 'the scan must name the file it found the secret in')
  // The whole trace, not only the lines the card keeps: every member of the
  // private project can read it.
  mustNotContain(trace, [LEAKED_PASSWORD], 'the job log must not print the password')
  mustContain(trace, ["password: 'REDACTED'"], 'the job log must show where the password was')
  const publish = (jobs || []).find(j => j.name === 'publish-source')
  if (!publish || publish.status === 'success') {
    throw new Error(`The publication must not run after a failed scan, publish-source: ${JSON.stringify(publish && publish.status)}`)
  }
  // Taller: the scanner's finding, the file and the line, and the related jobs
  // where publish-source never started.
  await publicationJobFrame('publication-ci-secret', job.id, 'publication:scan', 900)
  // The page the card was taken from: what GitLab drew there.
  mustNotContain(await I.grabTextFrom('[data-testid="job-log-content"]'), [LEAKED_PASSWORD],
    'the job page must not show the password')
})

// The same scan on a developer's machine: Docker, and no betterleaks binary, so
// the publication starts the scanner image. No CI variable either, as on a
// laptop: the publication would read the commit it scans from them.
function developerRun (script) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'CI' && !key.startsWith('CI_')))
  const result = spawnSync('sh', ['-c', script], {
    cwd: global.pubRendered, env, encoding: 'utf8', timeout: 300000, maxBuffer: 10 * 1024 * 1024
  })
  if (result.error || result.status === null) throw new Error(`\`${script}\` did not finish: ${result.error || result.signal}`)
  return { exit: result.status, raw: result.stdout + result.stderr }
}

storyboardStep(When, 'the same scan, run in Docker on a machine without betterleaks, stops on the same password and prints REDACTED too', async () => {
  const where = developerRun('command -v betterleaks || echo "betterleaks is not installed"')
  if (where.raw.trim() !== 'betterleaks is not installed') {
    throw new Error(`This scan must run where betterleaks is not installed, found: ${where.raw}`)
  }
  const scan = developerRun('task publication:scan')
  const output = stripAnsiEscapeSequences(scan.raw)
  if (scan.exit === 0) throw new Error(`The scan must fail on the password:\n${output}`)
  // Only the real scanner prints its banner: with no binary, that is the image.
  mustContain(output, ['betterleaks', 'generic-password', LEAKED_FILE, "password: 'REDACTED'",
    'A secret was found in a file that was about to become public.'], 'the Docker scan must report the finding')
  if (!/│\s*7\s*│/.test(output)) throw new Error(`The Docker scan must name line 7:\n${output}`)
  mustNotContain(scan.raw, [LEAKED_PASSWORD], 'the Docker scan must not print the password')
  await terminalOutputFrame(I, 'publication-docker-secret', [
    '$ command -v betterleaks || echo "betterleaks is not installed"', where.raw.trimEnd(), '',
    '$ task publication:scan', maskText(screenText(scan.raw), [...TERMINAL_MASKS, ...JOB_MASKS])
  ].join('\n'))
})

// The cards below run more scans on the same machine. Each command is typed,
// then what it printed, in the order the developer's terminal shows them.
function developerCommands (commands) {
  return commands.map(command => ({ command, ...developerRun(command) }))
}

async function developerFrame (frameName, runs) {
  await terminalOutputFrame(I, frameName, runs.map(({ command, raw }) =>
    `$ ${command}\n${maskText(screenText(raw), [...TERMINAL_MASKS, ...JOB_MASKS])}`).join('\n\n'))
}

// The two verdicts a scan can give about the files. One that did not read them
// gives neither.
const SCAN_VERDICTS = ['No secret found', 'A secret was found']

function mustFailWithout (run, needles, what) {
  const output = stripAnsiEscapeSequences(run.raw)
  if (run.exit === 0) throw new Error(`${what}: \`${run.command}\` must fail:\n${output}`)
  mustContain(output, needles, what)
  mustNotContain(output, SCAN_VERDICTS, `${what}, without a verdict on the files`)
}

storyboardStep(When, 'a scan that is switched off fails instead of passing, and a pipeline refuses to publish without it', async () => {
  const [scan, publish] = developerCommands([
    'TASK_PUBLICATION_SCAN=off task publication:scan',
    'CI=true TASK_PUBLICATION_SCAN=off task publication:publish'
  ])
  mustFailWithout(scan, ['Secret scan skipped (TASK_PUBLICATION_SCAN=off).', 'Nothing was scanned'],
    'a scan that is switched off must say it scanned nothing')
  mustFailWithout(publish, ['a pipeline publishes only what it scanned', 'Nothing was published.'],
    'a pipeline must refuse to publish without a scan')
  mustNotContain(publish.raw, ['Pushed'], 'a pipeline must not publish without a scan')
  await developerFrame('publication-scan-off', [scan, publish])
})

// A configuration a project could really break: its closing bracket is missing.
const BROKEN_CONFIG = 'broken.toml'

storyboardStep(When, 'a scan whose scanner cannot run, or stops on an error, fails and says so', async () => {
  writeFixtureFile(global.pubRendered, BROKEN_CONFIG, '[allowlist]\npaths = ["^tmp/"\n')
  const [unreachable, shown, broken] = developerCommands([
    'DOCKER_HOST=unix:///run/no-docker.sock task publication:scan',
    `cat ${BROKEN_CONFIG}`,
    `TASK_PUBLICATION_SCAN_CONFIG=${BROKEN_CONFIG} task publication:scan`
  ])
  mustFailWithout(unreachable, ['The secret scan cannot run here'], 'a scan with no scanner must say it cannot run')
  mustFailWithout(broken, ['unable to load config', 'The secret scan did not finish'],
    'a scan whose scanner stopped must say it did not finish')
  await developerFrame('publication-scan-error', [unreachable, shown, broken])
})

storyboardStep(Then, 'only a scan that read every file to the end says no secret was found, here on release 1.4.0', async () => {
  const [scan] = developerCommands([`TASK_PUBLICATION_SOURCE_REF=${FIXTURE_TAG} task publication:scan`])
  const output = stripAnsiEscapeSequences(scan.raw)
  if (scan.exit !== 0) throw new Error(`The scan of release ${FIXTURE_TAG} must pass:\n${output}`)
  mustContain(output, [`Source      ${FIXTURE_TAG} (`, `Scanning    ${PUBLISHED.length} files for secrets`,
    'scanned ~', 'No secret found in what would become public.'], 'a clean scan must say what it read')
  await developerFrame('publication-scan-clean', [scan])
})

storyboardStep(Then, 'the public project still holds the first release, without the new file or the password', async () => {
  await storyFrame('publication-public-unchanged', gitlabUrl.file(global.pubPublic, 'main', LEAKED_FILE), {
    waitText: 'serve(process.env.PORT', height: 520, prepare: () => unfoldFileTree(I, ['server'])
  })
  await assertPublicProjectHolds(PUBLISHED, 'The public project must be untouched')
  const rootHeaders = await getRootHeaders()
  const published = await getRepositoryFile(global.pubPublic, LEAKED_FILE, 'main', rootHeaders)
  mustNotContain(published, ['Zt7', 'password'], 'The secret must never reach the public project')
  const commits = await listCommits(global.pubPublic, 'main', rootHeaders)
  if (commits.length !== 1) {
    throw new Error(`The public history must still hold the one release commit, found ${commits.length}`)
  }
})

// ===========================================================================
// @publication-only and @publication-existing-framework: the component
// installed on its own, and refused where a complete framework already lives.
//
// The same journey engine as agent mode: a real clone of a real test-GitLab
// project, the REAL working-branch installer, and its live gum checklist caught
// while it is on screen. GitLab opens and closes the story: the main branch
// before (README alone) and after the push (the component and its spine, and
// the answers file that records the release). The modes of the project's own
// files are working-tree facts git cannot carry, so the terminal shows them.
// ===========================================================================

// Namespaced: the top of this file belongs to the @source-publication story.
const gitlabCards = require('../helpers/gitlabCard')
const ttyCapture = require('../terminal/capture')
const gitlabApi = require('../helpers/gitlabApi')

const SCOPE_PROMPT = 'Install the complete DevSecOps framework?'
const CHECKLIST_HEADER = 'Select what to install'
const WIRING_PROMPT = 'Say where the source goes'
const INSTALLER_LINE = `bash ${WRAPPER_PATH}`
const PUBLICATION_COMMIT = 'chore: install source publication'
const FRAMEWORK_COMMIT = 'chore: install the complete DevSecOps framework'
const ANSWERS_FILE = '.config/devsecops/.copier-answers.yml'
// Tall enough for the Files panel of the pushed install, publication unfolded.
const REPO_PAGE_HEIGHT = 1040

const OWN_TOOL = '.config/own-tool.sh'
const PRIVATE_FILE = '.config/private.txt'
const OWN_TOOL_CONTENT = '#!/bin/sh\nprintf "%s\\n" "own tool works"\n'
const PRIVATE_CONTENT = 'Private project data for the installation test.\n'
// What the cards type: the modes, then the tool. With `task publication:check`
// after it, still one row of the 1440 px terminal.
const OWN_FILES_COMMAND = `stat -c '%a %n' ${OWN_TOOL} ${PRIVATE_FILE} && ${OWN_TOOL}`
// What the twin compares: the same, plus the contents.
const OWN_FILES_STATE = `${OWN_FILES_COMMAND} && sha256sum ${OWN_TOOL} ${PRIVATE_FILE}`

// A clean clone of a public README project (Auto DevOps off), the lambda token,
// the staged working-branch installer and template, and its toolchain, all off
// camera. The template is tagged as a release: copier records the tag it
// rendered from in the answers file, and that recorded release is what makes
// the component updatable later. `withDestination` adds the empty public
// project the source is told to go to; the install only has to be TOLD where to
// publish, publishing is the daily-work story's job.
async function componentJourneySetup ({ withDestination }) {
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
  const headers = { 'PRIVATE-TOKEN': global.pubLambdaToken }
  const created = await createProject(
    { name: global.pubPrivate, visibility: 'public', initialize_with_readme: true, auto_devops_enabled: false },
    headers
  )
  if (created.status >= 400) {
    throw new Error(`Failed to create the project: ${created.status} ${JSON.stringify(created.data)}`)
  }
  if (withDestination) {
    global.pubPublic = `${global.pubPrivate}-public`
    const createdPublic = await createProject({ name: global.pubPublic, visibility: 'public' }, headers)
    if (createdPublic.status >= 400) {
      throw new Error(`Failed to create the public project: ${createdPublic.status} ${JSON.stringify(createdPublic.data)}`)
    }
  }

  global.pubContainer = setupClonedProjectTerminal(global.pubPrivate, global.pubLambdaToken)
  prepareWorkingBranchInstaller(global.pubContainer)
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
  preinstallToolchain(global.pubContainer)
}

// The project's own tool (0750) and private file (0600), which no install may
// touch. The private file never leaves the developer's machine: git ignores it.
function prepareExistingPublicationFiles () {
  inProjectOrThrow([
    'mkdir -p -m 755 .config',
    `printf %s ${shellEscape(OWN_TOOL_CONTENT)} > ${OWN_TOOL}`,
    `printf %s ${shellEscape(PRIVATE_CONTENT)} > ${PRIVATE_FILE}`,
    `chmod 750 ${OWN_TOOL}`,
    `chmod 600 ${PRIVATE_FILE}`,
    `echo /${PRIVATE_FILE} >> .git/info/exclude`
  ].join(' && '))
  const state = inProjectOrThrow(OWN_FILES_STATE)
  mustContain(state, [`750 ${OWN_TOOL}`, `600 ${PRIVATE_FILE}`, 'own tool works'],
    'the project files must start with their intended permissions and behaviour')
  for (const content of [OWN_TOOL_CONTENT, PRIVATE_CONTENT]) {
    mustContain(state, crypto.createHash('sha256').update(content).digest('hex'),
      'the project files must start with their exact fixture contents')
  }
  global.pubExistingFiles = state
}

function assertExistingPublicationFiles () {
  const state = inProjectOrThrow(OWN_FILES_STATE)
  if (state !== global.pubExistingFiles) {
    throw new Error('Installing source publication changed a file of the project, its permissions or its execution:\n' + state)
  }
}

function projectFileState () {
  const files = inProjectOrThrow(
    "find . -path './.git' -prune -o -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum"
  )
  const modes = inProjectOrThrow(
    "find . -path './.git' -prune -o \\( -type f -o -type d \\) -printf '%m %p\\n' | LC_ALL=C sort"
  )
  return { files, modes }
}

function assertExistingProject () {
  const after = projectFileState()
  for (const key of ['files', 'modes']) {
    if (after[key] !== global.pubExistingProject[key]) {
      throw new Error('The component preflight changed the complete project: ' + key)
    }
  }
  assertExistingPublicationFiles()
}

// Off camera, the way a developer pushes: everything git does not ignore. The
// clone's remote already carries the token, so nothing secret is typed, and
// ci.skip keeps a pipeline from waiting forever on a runner these projects do
// not have: the story is about files.
function pushToMain (message) {
  inProjectOrThrow(`git add -A && git commit -q -m ${shellEscape(message)} && git push -q -o ci.skip origin main`)
  if (inProjectOrThrow('git status --porcelain').trim()) {
    throw new Error('The push must leave a clean working tree')
  }
}

// A page of the main branch, its Files panel unfolded on `unfold`. Public
// project: the anonymous view, no login. The skipped pipeline's icon is hidden.
async function mainBranchCard (frameName, url, waitText, unfold = []) {
  await gitlabCards.gitlabFrame(I, frameName, url, {
    waitText,
    height: REPO_PAGE_HEIGHT,
    hide: ['[data-testid="ci-icon"]', '.ci-status-link'],
    prepare: unfold.length ? () => gitlabCards.unfoldFileTree(I, unfold) : null
  })
}

async function treeNames (dir = '') {
  const res = await listRepositoryTree(global.pubPrivate, { 'PRIVATE-TOKEN': global.pubLambdaToken },
    `?ref=main&per_page=100${dir ? `&path=${encodeURIComponent(dir)}` : ''}`)
  return (res.data || []).map(entry => entry.name).sort()
}

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

storyboardStep(Given, 'a project on GitLab whose main branch holds only its README', async () => {
  await componentJourneySetup({ withDestination: true })
  await mainBranchCard('publication-only-gitlab-before', gitlabCards.gitlabUrl.tree(global.pubPrivate), 'Initial commit')
  const root = await treeNames()
  if (JSON.stringify(root) !== JSON.stringify(['README.md'])) {
    throw new Error(`The main branch must hold only README.md, found ${JSON.stringify(root)}`)
  }
  if (inProjectOrThrow('git status --porcelain').trim()) throw new Error('The clone must start clean')
})

// The terminal opens 1440 wide, so the longest typed line of the story fits on
// one row, and tall enough for the whole installer run.
storyboardStep(Given, "the developer's copy already has its own executable tool and an owner-only file under its configuration directory", async () => {
  prepareExistingPublicationFiles()
  await ttyCapture.openTerminal(I, global.pubContainer, { width: 1440 })
  const screen = await ttyCapture.terminalCard(I, 'publication-only-own-files-before', OWN_FILES_COMMAND, { mask: TERMINAL_MASKS })
  mustContain(screen, [`750 ${OWN_TOOL}`, `600 ${PRIVATE_FILE}`, 'own tool works'],
    'the card must show the modes and the tool running')
})

// The checklist, caught live, from the typed command down: gum erases it the
// moment it is answered. The AI agent line opens ticked: untick it, move down,
// tick source publication. Shared by both stories.
storyboardStep(When, 'the developer ticks source publication on the checklist', async () => {
  I.click('.xterm-screen')
  I.type(INSTALLER_LINE)
  I.pressKey('Enter')
  await waitForTerminalText(I, SCOPE_PROMPT, COMMAND_TIMEOUT_MS)
  await waitForTerminalSettle(I)
  I.pressKey('ArrowRight')
  await waitForTerminalSettle(I)
  I.pressKey('Enter')
  await waitForTerminalText(I, CHECKLIST_HEADER, COMMAND_TIMEOUT_MS)
  await waitForTerminalSettle(I)
  I.pressKey('Space')
  I.pressKey('ArrowDown')
  I.pressKey('Space')
  // A tick changes no line length, so wait for the tick itself, not for quiet.
  await I.waitForFunction(() => {
    const text = document.querySelector('.xterm-screen').textContent
    return text.includes('✓ Source publication') && !text.includes('✓ Agent mode')
  }, 30)
  await waitForTerminalSettle(I)
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'publication-only-checklist', {
    fromMarker: INSTALLER_LINE, mask: TERMINAL_MASKS
  }))
  const screen = await ttyCapture.terminalScreenText(I)
  if (screen.includes(SCOPE_PROMPT) || !screen.includes('✓ Source publication') || screen.includes('✓ Agent mode')) {
    throw new Error(`Expected the question gone and only source publication ticked:\n${screen}`)
  }
  I.pressKey('Enter')
})

// The installer's last act, and the only one that needs a forge: it asks where
// the source goes and for the two tokens that get it there, then does the whole
// GitLab side with them. The tokens are typed with echo off, so this card can be
// a picture of the real thing without a secret in it.
storyboardStep(When, 'the developer says where the source goes and hands over the tokens', async () => {
  await waitForTerminalText(I, WIRING_PROMPT, COMMAND_TIMEOUT_MS)
  await waitForTerminalSettle(I)
  I.pressKey('Enter')

  await waitForTerminalText(I, 'Your token for THIS repository', COMMAND_TIMEOUT_MS)
  I.type(global.pubLambdaToken)
  I.pressKey('Enter')

  await waitForTerminalText(I, 'The PUBLIC repository', COMMAND_TIMEOUT_MS)
  I.type(new URL(`/${lambdaUser()}/${global.pubPublic}.git`, BASE_URL).href)
  I.pressKey('Enter')

  await waitForTerminalText(I, 'A token that may push to it', COMMAND_TIMEOUT_MS)
  I.type(global.pubLambdaToken)
  I.pressKey('Enter')

  // The one question that is not a credential: enter keeps the secret scan on.
  await waitForTerminalText(I, 'Scan what becomes public for secrets before each publication?', COMMAND_TIMEOUT_MS)
  I.pressKey('Enter')

  await ttyCapture.waitForPromptReturn(I, INSTALLER_LINE, 300000)
  await waitForTerminalSettle(I)
  const screen = await ttyCapture.terminalScreenText(I)
  mustContain(screen, ['Source publication installed, with the spine that keeps it up to date.',
    'TASK_RENOVATE_TOKEN created', 'nightly schedule', 'scanned for secrets first', 'Installation complete!'],
  'the install must do the GitLab side, not just ask about it')
  mustNotContain(screen, global.pubLambdaToken, 'a token typed blind must never reach the screen')
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'publication-only-wiring', {
    fromMarker: 'Installing source publication', mask: TERMINAL_MASKS
  }))
})

// Before the push: once committed, every installed file is tracked and the
// check would list them all.
storyboardStep(Then, "the project's own files are untouched, and the component says what would become public", async () => {
  const screen = await ttyCapture.terminalCard(I, 'publication-only-own-files-after',
    `${OWN_FILES_COMMAND} && task publication:check`, { mask: TERMINAL_MASKS })
  assertExistingPublicationFiles()
  mustContain(screen, [`750 ${OWN_TOOL}`, `600 ${PRIVATE_FILE}`, 'own tool works',
    'Source publication', `${global.pubPublic}.git`, 'README.md', 'no approved list yet'],
  'the project files must be untouched and the component must answer on its own')
})

// The push is off camera; its proof is the main branch on GitLab. The twins read
// the same branch over REST: the five root entries, the component whole, the
// spine there and no tool, the private file absent, the release recorded.
storyboardStep(When, 'the developer pushes the install to the main branch, GitLab shows the component, its update spine and the release it came from', async () => {
  pushToMain(PUBLICATION_COMMIT)
  await mainBranchCard('publication-only-gitlab-after',
    gitlabCards.gitlabUrl.file(global.pubPrivate, 'main', ANSWERS_FILE), PUBLICATION_COMMIT, ['publication'])

  const root = await treeNames()
  const expected = ['.config', '.env.dist', '.gitlab-ci.yml', 'README.md', 'Taskfile.yml']
  if (JSON.stringify(root) !== JSON.stringify(expected)) {
    throw new Error(`The main branch must hold exactly ${JSON.stringify(expected)}, found ${JSON.stringify(root)}`)
  }
  const config = await treeNames('.config')
  mustContain(config.join('\n'), ['copier', 'devsecops', 'publication', 'python', 'renovate', 'task', 'own-tool.sh'],
    'the update spine must travel with the component, beside the project\'s own tool')
  mustNotContain(config.join('\n'), ['megalinter', 'docker', 'glab', 'codeceptjs', 'private.txt'],
    'a component-only install must bring no tooling, and the private file must stay local')
  mustContain((await treeNames('.config/publication')).join('\n'),
    ['allowlist', 'denylist', 'denylist.base', 'manifest', 'owners', 'publish.sh'], 'the component must arrive whole')
  const answers = await gitlabApi.getRepositoryFile(global.pubPrivate, ANSWERS_FILE, 'main',
    { 'PRIVATE-TOKEN': global.pubLambdaToken })
  mustContain(answers, ['_commit: 1.0.0', 'install_scope: publication'],
    'the main branch must record the release that rendered it')
})

storyboardStep(Then, 'GitLab holds the tokens, masked and protected', async () => {
  // The settings the install just wrote are private to the project: an anonymous
  // browser is answered with a 404. The developer who ran the installer looks.
  await GitLabUserPage.loginAs(lambdaUser(), process.env.TASK_GITLAB_LAMBDA_PASSWORD)
  await gitlabCards.ciVariablesFrame(I, 'publication-only-variables', global.pubPrivate)
  const headers = { 'PRIVATE-TOKEN': global.pubLambdaToken }
  const all = await freshGet(`${BASE_URL}/api/v4/projects/${encodedProjectPath(global.pubPrivate)}/variables`, headers)
  const keys = (all.data || []).map(v => v.key).sort()
  if (JSON.stringify(keys) !== JSON.stringify(['TASK_PUBLICATION_SOURCE_TOKEN', 'TASK_PUBLICATION_TOKEN', 'TASK_RENOVATE_TOKEN'])) {
    throw new Error(`The install must create exactly three CI/CD variables, found ${JSON.stringify(keys)}`)
  }
  for (const name of keys) {
    const variable = await readProjectVariable(global.pubPrivate, name, headers)
    if (variable.status >= 400) {
      throw new Error(`${name} must exist as a CI/CD variable, got ${variable.status}`)
    }
    if (variable.data.masked !== true || variable.data.protected !== true) {
      throw new Error(`${name} must be masked and protected, got masked=${variable.data.masked}, protected=${variable.data.protected}`)
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
  const project = await freshGet(`${BASE_URL}/api/v4/projects/${encodedProjectPath(global.pubPrivate)}`, headers)
  if (project.status !== 200 || project.data.only_allow_merge_if_all_discussions_are_resolved !== true) {
    throw new Error('Publication setup must enable the discussion merge gate in GitLab')
  }
})

storyboardStep(Then, 'a nightly check will bring the next toolbox release in', async () => {
  await gitlabCards.gitlabFrame(I, 'publication-only-schedule',
    `${gitlabCards.gitlabUrl.project(global.pubPrivate)}/-/pipeline_schedules`, { waitText: '0 4 * * *', height: 480 })
  const schedules = await listPipelineSchedules(global.pubPrivate, { 'PRIVATE-TOKEN': global.pubLambdaToken })
  const nightly = (schedules.data || []).find(s => s.description.startsWith('Source publication'))
  if (!nightly) {
    throw new Error(`No pipeline schedule was created: ${JSON.stringify(schedules.data)}`)
  }
  if ((nightly.ref !== 'main' && nightly.ref !== 'refs/heads/main') || nightly.cron !== '0 4 * * *' || nightly.active !== true) {
    throw new Error(`The schedule must run every night at four on main, got ${JSON.stringify(nightly)}`)
  }
})

// A real copier render with the complete scope, its own choices (podman, the
// project workspace, publication off), and the project's own two files,
// committed and pushed to the main branch off camera. The card is the answers
// file the refusal names; the twin reads it on the main branch. Then the whole
// project's files, contents and modes are recorded for the refusal's twin, and
// a fresh terminal opens for the installer.
storyboardStep(Given, 'a project whose main branch already carries the complete framework and its own Copier choices', async () => {
  await componentJourneySetup({ withDestination: false })
  inProjectOrThrow(
    'umask 022 && export PATH="$HOME/.local/bin:$PATH" && ' +
    COPIER + ' copy --trust --skip-tasks --defaults --quiet --overwrite --vcs-ref 1.0.0' +
    ' --data install_scope=everything --data container_runtime=podman --data project_enabled=true' +
    ' --data use_docker_compose=false --data source_publication=false ' + TEMPLATE_DIR + ' .'
  )
  prepareExistingPublicationFiles()
  pushToMain(FRAMEWORK_COMMIT)
  global.pubExistingProject = projectFileState()
  await mainBranchCard('publication-existing-framework-before',
    gitlabCards.gitlabUrl.file(global.pubPrivate, 'main', ANSWERS_FILE), FRAMEWORK_COMMIT)
  const answers = await gitlabApi.getRepositoryFile(global.pubPrivate, ANSWERS_FILE, 'main',
    { 'PRIVATE-TOKEN': global.pubLambdaToken })
  mustContain(answers, ['install_scope: everything', 'container_runtime: podman',
    'project_enabled: true', 'source_publication: false'],
  'the main branch must carry real Copier answers for a complete project')
  await ttyCapture.openTerminal(I, global.pubContainer, { width: 1440 })
})

// The refusal, live, from the typed command down, then the developer's own
// `git status`. The installer's exit status is read from its session log:
// script(1) records it, its wrapper does not propagate it.
storyboardStep(Then, 'the installer refuses, names the update path, and leaves the project exactly as the main branch holds it', async () => {
  // The old installer reaches setup instead of refusing. Decline that prompt so
  // RED is an assertion on its real exit status, not a timeout waiting for an
  // error message that the old product never printed.
  await waitInstallerLog(`${WIRING_PROMPT}\\|COMMAND_EXIT_CODE`)
  if (execInContainerAsUser(global.pubContainer, 'bootstrap', 'cat ' + INSTALL_LOG).output.includes(WIRING_PROMPT)) {
    await waitForTerminalText(I, WIRING_PROMPT, COMMAND_TIMEOUT_MS)
    I.type('n')
    I.pressKey('Enter')
  }
  await waitInstallerLog('COMMAND_EXIT_CODE')
  await ttyCapture.waitForPromptReturn(I, INSTALLER_LINE, 60000)
  const log = execInContainerAsUser(global.pubContainer, 'bootstrap', 'cat ' + INSTALL_LOG).output
  await typeCommandAndWait(I, 'git status', COMMAND_TIMEOUT_MS)
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'publication-existing-framework-refused', {
    fromMarker: INSTALLER_LINE, mask: TERMINAL_MASKS
  }))

  const exit = log.match(/COMMAND_EXIT_CODE="(\d+)"/)
  if (!exit) throw new Error('The installer session did not record its exit status:\n' + log)
  if (Number(exit[1]) === 0) {
    throw new Error('Component installation must refuse an existing full Copier project, but the installer returned 0')
  }
  const screen = await ttyCapture.terminalScreenText(I)
  mustContain(screen, ['already describes a complete framework installation', 'task copier:update',
    '--data source_publication=true', "Your branch is up to date with 'origin/main'.", 'nothing to commit, working tree clean'],
  'the refusal must name the existing answers and the supported update, and git must find nothing changed')
  assertExistingProject()
})
