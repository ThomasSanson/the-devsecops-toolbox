/* global inject Given When Then After */
/**
 * Storyboard for @renovate-flow (features/03-evolution/renovate.feature).
 *
 * The real Renovate bot, twice, against the test GitLab, the way the scheduled
 * job runs it: `task renovate TASK_RENOVATE_PLATFORM=gitlab`, with copier on
 * the PATH because the feedback job installs it first.
 *   1. On a project generated from an older release of a toolbox copy: the bot
 *      must open the toolbox update and the toml update, nothing for
 *      the framework-owned tools, and the toolbox update must carry the release.
 *      Nothing either for the project's own image, pinned one release behind in
 *      a deployment manifest: bumping it with a fix commit made a release, whose
 *      image Renovate bumped again, in a loop (issue #234).
 *      Then the developer pins two more dependencies and the bot runs again:
 *      the minor and patch updates of project/ share one merge request, the
 *      major update keeps its own. With fast-forward merges, every open merge
 *      request is rebased, and its pipeline rerun, after each merge.
 *   2. On that toolbox copy itself, five dependencies pinned back: one merge
 *      request per dependency, each moving every place the dependency is pinned.
 * Every card is a GitLab page (a merge request list, a Changes tab), twinned
 * with the bot's JSON debug log and the GitLab API. Both projects run no CI,
 * and nobody may merge into their main branch: the framework's configs
 * automerge, and GitLab would merge a pipeline-less merge request at once.
 */
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const path = require('path')
const { spawn, execFileSync } = require('child_process')
const { REPO, toolboxRepository } = require('../helpers/frameworkCopy')
const { renderProjectFromTemplate } = require('../helpers/copierRender')
const { publishToGitLab } = require('../helpers/gitlabProject')
const { gitlabFrame, gitlabUrl } = require('../helpers/gitlabCard')
const { BASE_URL, projectPath, encodedProjectPath, listProjectMergeRequests, getRepositoryFile } = require('../helpers/gitlabApi')
const { freshGet, freshPost, freshDelete } = require('../helpers/http')
const { openLocalTerminal } = require('../helpers/localTerminal')
const { terminalCard } = require('../terminal/capture')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const { I } = inject()

const ANSWERS = '.config/devsecops/.copier-answers.yml'
const INSTALL_SH = '.config/devsecops/install.sh'
const RENOVATE_TIMEOUT_MS = 15 * 60 * 1000

// The two releases of the toolbox copy. 1.0.1 moves two framework-owned tools
// whose lookups need no GitHub token, so a downstream Renovate that tracked
// .config WOULD open a merge request for each. Fixture values on both sides:
// the cards never move with the real pins.
const RELEASES = {
  '1.0.0': { '.config/node/version': '22.0.0', '.config/glab/version': '1.40.0' },
  '1.0.1': { '.config/node/version': '22.1.0', '.config/glab/version': '1.41.0' }
}
// The developer's own dependency: toml stopped at 0.10.2 in 2020, so the
// update Renovate proposes never moves either.
const OWN_DEPENDENCY = { file: 'project/requirements.txt', pin: 'toml==0.10.0' }
// The project's own image, deployed from a Kustomize overlay as EOS does, one
// release behind its registry. The test GitLab runs no container registry: a
// stand-in in this container lists the image's two tags, and plain HTTP is
// the run's only test setting.
const OWN_IMAGE = {
  overlay: 'project/kustomize/overlays/staging/kustomization.yaml',
  port: 5050,
  tags: ['0.2.0', '0.2.1'],
  pinned: '0.2.0'
}
const DOWNSTREAM_RUN_ENV = {
  RENOVATE_CONFIG: JSON.stringify({ hostRules: [{ hostType: 'docker', matchHost: 'localhost', insecureRegistry: true }] }) // DevSkim: ignore DS162092 -- The suite's own test registry on the local network; never a deployed endpoint.
}
const DOWNSTREAM_FILES = [ANSWERS, OWN_IMAGE.overlay, OWN_DEPENDENCY.file]
// The developer's next two dependencies. nose stopped at 1.3.7 in 2015, a
// minor update away; oauth2client stopped at 4.1.3 in 2018, and its 3 line
// never got a second release, so only a major update is waiting. Every update
// Renovate proposes is final, so titles and diffs are fixtures too.
const MORE_DEPENDENCIES = ['nose==1.2.1', 'oauth2client==3.0.0']
const GROUP = {
  title: 'fix(deps): update project dependencies',
  added: ['+toml==0.10.2', '+nose==1.3.7'],
  removed: ['-toml==0.10.0', '-nose==1.2.1']
}
const MAJOR = {
  title: 'fix(deps): update dependency oauth2client to v4',
  added: ['+oauth2client==4.1.3'],
  removed: ['-oauth2client==3.0.0']
}
// The second run comes minutes after the first, where the scheduled job waits
// a day: Renovate's limit of two new merge requests an hour would hold the
// second run's back, or not, depending on the clock.
const DOWNSTREAM_RERUN_ENV = {
  RENOVATE_CONFIG: JSON.stringify({ ...JSON.parse(DOWNSTREAM_RUN_ENV.RENOVATE_CONFIG), prHourlyLimit: 0 })
}
const TOOLBOX_UPDATE_FILES = [ANSWERS, ...Object.keys(RELEASES['1.0.1'])].sort()

// The commit on the toolbox's main branch after both releases: five
// dependencies pinned back, and the installer's other pins too, so every line
// the copier card shows around its own is a fixture.
const MEGALINTER_IMAGE = /ghcr\.io\/oxsecurity\/megalinter:v[0-9][^\s"]*/g
const PIN_BACK = [
  ['.config/copier/requirements.txt', /copier==[0-9][0-9.]*/, 'copier==9.0.1'],
  [INSTALL_SH, /^COPIER_VERSION="[^"]*"/m, 'COPIER_VERSION="copier==9.0.1"'],
  [INSTALL_SH, /^TASK_VERSION="[^"]*"/m, 'TASK_VERSION="3.40.0"'],
  [INSTALL_SH, /^GUM_VERSION="[^"]*"/m, 'GUM_VERSION="0.14.0"'],
  [INSTALL_SH, /^GLOW_VERSION="[^"]*"/m, 'GLOW_VERSION="2.0.0"'],
  ['.config/megalinter/package.json', /"mega-linter-runner": "[^"]+"/, '"mega-linter-runner": "9.1.0"'],
  ['.config/gitlab/ci/devsecops/code.yml', MEGALINTER_IMAGE, 'ghcr.io/oxsecurity/megalinter:v9.1.0'],
  ['.config/gitlab/ci/devsecops/code.yml.jinja', MEGALINTER_IMAGE, 'ghcr.io/oxsecurity/megalinter:v9.1.0'],
  ['.config/codeceptjs/package.json', /"playwright": "[^"]+"/, '"playwright": "1.40.0"'],
  ['.config/codeceptjs/Dockerfile', /^FROM mcr\.microsoft\.com\/playwright:\S+/m, 'FROM mcr.microsoft.com/playwright:v1.50.0'],
  ['.config/ansible/requirements.txt', /ansible-core==\S+/, 'ansible-core==2.16.0']
]

// The five, and the one newer release each is held to: old release lines no
// upstream patches any more, so titles and diffs are fixtures too. MegaLinter
// 9.5.0 only exists on ghcr.io (Docker Hub stopped at 9.4.0): a Renovate that
// read the abandoned registry would propose nothing at all.
const UPDATES = {
  'ansible-core': '2.16.1',
  copier: '9.1.0',
  'mcr.microsoft.com/playwright': 'v1.50.1',
  'oxsecurity/megalinter': '9.5.0',
  playwright: '1.41.0'
}
const COPIER_FILES = ['.config/copier/requirements.txt', INSTALL_SH]
const MEGALINTER_FILES = ['.config/gitlab/ci/devsecops/code.yml', '.config/gitlab/ci/devsecops/code.yml.jinja', '.config/megalinter/package.json']
// The toolbox's own minor and patch updates share one merge request; the
// tools that change what its tests see keep their own (.config/renovate/config.json).
const GROUPED = ['ansible-core', 'copier', 'oxsecurity/megalinter']
const APART = ['playwright', 'mcr.microsoft.com/playwright']
const GROUP_BRANCH = /toolbox-dependencies$/
const GROUP_FILES = ['.config/ansible/requirements.txt', ...COPIER_FILES, ...MEGALINTER_FILES].sort()

// Every place a bootstrap tool is pinned: its .config source and install.sh,
// which installs it before the toolbox is on the machine.
const TOOLS = [
  { depName: 'go-task/task', source: '.config/task/version', pinVar: 'TASK_VERSION' },
  { depName: 'copier', source: '.config/copier/requirements.txt', pinVar: 'COPIER_VERSION' },
  { depName: 'charmbracelet/gum', source: '.config/gum/version', pinVar: 'GUM_VERSION' },
  { depName: 'charmbracelet/glow', source: '.config/glow/version', pinVar: 'GLOW_VERSION' }
]

// Test-only settings of the toolbox run, merged after the framework's own
// config: every dependency off but the five, each held to its one release, and
// no hourly limit (Renovate opens two merge requests an hour by default).
// The off switch only lists the five as exceptions and never turns one back
// on: a framework rule that disables one of them still wins, and the "exactly
// one update branch" twin fails.
const TOOLBOX_RUN_ENV = {
  RENOVATE_INCLUDE_PATHS: [...new Set([...PIN_BACK.map(([file]) => file), ...TOOLS.map(tool => tool.source)])].join(','),
  RENOVATE_CONFIG: JSON.stringify({
    prHourlyLimit: 0,
    prConcurrentLimit: 0,
    packageRules: [
      { matchPackageNames: Object.keys(UPDATES).map(name => `!${name}`), enabled: false },
      ...Object.entries(UPDATES).map(([name, version]) => ({
        matchPackageNames: [name],
        allowedVersions: `/^${version.replace(/\./g, '\\.')}$/`
      }))
    ]
  })
}

// The toolbox copy's per-run name, wherever GitLab prints it (the answers
// file, the update's branch name, the toolbox's own pages).
const TOOLBOX_NAME = /e2e-renovate-toolbox-[0-9a-f]{8}/g
const TOOLBOX_MASK = [[TOOLBOX_NAME, 'toolbox']]

let story = null

After(async () => {
  if (!story) return
  const { pubs, dirs, registry } = story
  story = null
  if (registry) await new Promise(resolve => registry.server.close(resolve))
  for (const pub of pubs) await pub.teardown()
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true })
})

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function tempDir (prefix) {
  const dir = fs.mkdtempSync(`/tmp/${prefix}-`)
  story.dirs.push(dir)
  return dir
}

function git (dir, ...args) {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' })
}

function pin (dir, file, re, to) {
  const target = path.join(dir, file)
  const text = fs.readFileSync(target, 'utf8')
  if (text.search(re) === -1) throw new Error(`Fixture: nothing matches ${re} in ${file}`)
  fs.writeFileSync(target, text.replace(re, to))
}

// A copy of the framework as a toolbox with releases 1.0.0 and 1.0.1, then the
// pin-back commit on its main branch.
function buildToolbox () {
  const dir = toolboxRepository(tempDir('e2e-renovate-toolbox'))
  for (const [release, pins] of Object.entries(RELEASES)) {
    for (const [file, version] of Object.entries(pins)) fs.writeFileSync(path.join(dir, file), `${version}\n`)
    git(dir, 'add', '-A')
    git(dir, 'commit', '--quiet', '-m', `chore: release ${release}`)
    git(dir, 'tag', release)
  }
  for (const [file, re, to] of PIN_BACK) pin(dir, file, re, to)
  // A lockfile still holding the newest playwright would make Renovate answer
  // "already up to date" to the package.json pinned back above.
  for (const lock of ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock']) {
    fs.rmSync(path.join(dir, '.config/codeceptjs', lock), { force: true })
  }
  git(dir, 'add', '-A')
  git(dir, 'commit', '--quiet', '-m', 'chore: pin five dependencies back')
  return dir
}

// The project's registry: the image's tags, and every request Renovate makes.
async function startRegistry (repository) {
  const registry = { requests: [] }
  registry.server = http.createServer((request, response) => {
    registry.requests.push(request.url)
    const tags = request.url.startsWith(`/v2/${repository}/tags/list`)
    response.writeHead(tags || request.url === '/v2/' ? 200 : 404, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(tags ? { name: repository, tags: OWN_IMAGE.tags } : {}))
  })
  await new Promise((resolve, reject) => {
    registry.server.once('error', reject)
    registry.server.listen(OWN_IMAGE.port, resolve)
  })
  return registry
}

function pushTags (dir, pub) {
  const remote = new URL(`http://gitlab/${projectPath(pub.projectName)}.git`) // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
  remote.username = process.env.TASK_GITLAB_LAMBDA_USER
  remote.password = pub.token
  try {
    execFileSync('git', ['-C', dir, 'push', '--quiet', remote.href, '--tags'], { stdio: 'pipe' })
  } catch (_) {
    // The push URL carries the token: never let the arguments reach a log.
    throw new Error(`Could not push the release tags to ${pub.projectName}`)
  }
}

// Nobody may merge into main: the framework's configs automerge, and GitLab
// merges a merge request with no pipeline the moment Renovate asks. GitLab
// protects the default branch itself, from a worker, a beat after the first
// push: retry until main reads merge = No one.
async function forbidMerges (project, headers) {
  const url = `${BASE_URL}/api/v4/projects/${encodedProjectPath(project)}/protected_branches`
  const deadline = Date.now() + 30000
  let last = null
  while (Date.now() < deadline) {
    await freshDelete(`${url}/main`, headers)
    last = await freshPost(`${url}?name=main&push_access_level=40&merge_access_level=0`, {}, headers)
    const now = await freshGet(`${url}/main`, headers)
    if (((now.data && now.data.merge_access_levels) || []).some(level => level.access_level === 0)) return
    await sleep(1000)
  }
  throw new Error(`Could not forbid merges into main on ${project}: ${last && last.status} ${JSON.stringify(last && last.data)}`)
}

// `task renovate` from a checkout of the project, against the test GitLab, as
// the scheduled job runs it. JSON debug log, parsed for the twins.
function runRenovate (dir, project, token, env = {}) {
  const shims = tempDir('e2e-renovate-shims')
  const copier = fs.readFileSync(path.join(dir, '.config/copier/requirements.txt'), 'utf8').trim()
  fs.writeFileSync(path.join(shims, 'copier'), `#!/bin/sh\nexec uvx --python 3.14 --from ${copier} copier "$@"\n`, { mode: 0o755 })
  const args = [
    'renovate',
    'TASK_RENOVATE_PLATFORM=gitlab',
    `TASK_RENOVATE_ENDPOINT=${BASE_URL}/api/v4`,
    `TASK_RENOVATE_TOKEN=${token}`,
    `TASK_RENOVATE_REPOSITORY=${projectPath(project)}`,
    'TASK_RENOVATE_LOG_LEVEL=debug'
  ]
  const childEnv = {
    ...process.env,
    PATH: `${shims}:${process.env.PATH}`,
    LOG_FORMAT: 'json',
    RENOVATE_BASE_DIR: tempDir('e2e-renovate-base'),
    npm_config_loglevel: 'error',
    ...env
  }
  return new Promise((resolve, reject) => {
    const child = spawn('task', args, { cwd: dir, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], timeout: RENOVATE_TIMEOUT_MS })
    const chunks = []
    child.stdout.on('data', chunk => chunks.push(chunk))
    child.stderr.on('data', chunk => chunks.push(chunk))
    child.on('error', reject)
    child.on('close', code => {
      const out = Buffer.concat(chunks).toString('utf8').split(token).join('<token>')
      const entries = out.split('\n').map(line => { try { return JSON.parse(line) } catch (_) { return null } }).filter(Boolean)
      if (code !== 0) {
        const problems = entries.filter(e => e.level >= 40).map(e => `${e.msg} ${e.err ? e.err.message : ''}`)
        return reject(new Error(`task renovate exited ${code} on ${project}:\n${problems.join('\n')}\n${out.slice(-3000)}`))
      }
      resolve(entries)
    })
  })
}

// Renovate's own record of what it scanned and proposed, per manager.
function packageFilesOf (entries) {
  const entry = entries.find(e => e.msg === 'packageFiles with updates')
  if (!entry) throw new Error('Renovate logged no "packageFiles with updates": it never looked anything up')
  return Object.values(entry.config || entry.packageFiles || {}).flat()
}

// depName -> { files: Set of package files, branches: Set of update branches }
function dependencies (packageFiles) {
  const deps = {}
  for (const pf of packageFiles) {
    for (const dep of pf.deps || []) {
      const seen = deps[dep.depName] = deps[dep.depName] || { files: new Set(), branches: new Set(), versions: new Set() }
      seen.files.add(pf.packageFile)
      for (const update of dep.updates || []) {
        if (update.branchName) seen.branches.add(update.branchName)
        if (update.newValue) seen.versions.add(update.newValue)
      }
    }
  }
  return deps
}

async function openMergeRequests (project, headers) {
  const res = await listProjectMergeRequests(project, headers, '?state=opened&per_page=100')
  if (res.status >= 400) throw new Error(`Listing the merge requests of ${project}: HTTP ${res.status}`)
  return res.data
}

// GitLab computes a merge request's diff in the background: wait for it.
async function mergeRequestChanges (project, iid, headers) {
  const url = `${BASE_URL}/api/v4/projects/${encodedProjectPath(project)}/merge_requests/${iid}/changes`
  const deadline = Date.now() + 60000
  for (;;) {
    const res = await freshGet(url, headers)
    const changes = (res.data && res.data.changes) || []
    if (changes.length || Date.now() > deadline) return changes
    await sleep(3000)
  }
}

function assertSameList (what, actual, expected) {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${what}: expected ${JSON.stringify([...expected].sort())}, got ${JSON.stringify([...actual].sort())}`)
  }
}

// The Changes tab keeps its Files panel open, whatever the number of files:
// every Changes card shows the same layout, and the panel says what is in play.
async function openFilesPanel () {
  await I.executeScript(() => {
    if (document.querySelector('[data-testid="file-tree-container"], .diff-tree-list, [class*="tree-list-holder"]')) return
    const toggle = Array.from(document.querySelectorAll('button')).find(b =>
      /file browser|file tree|hide files|show files/i.test(`${b.getAttribute('aria-label') || ''} ${b.title || ''}`))
    if (toggle) toggle.click()
  })
}

async function changesFrame (frameName, project, iid, waitText, { projectNames = null, height } = {}) {
  await gitlabFrame(I, frameName, gitlabUrl.mr(project, iid, 'diffs'), {
    waitText, height, projectNames, textMasks: TOOLBOX_MASK, prepare: openFilesPanel
  })
}

// Open merge requests, sorted by title, so the rows come in one order. GitLab
// prints "updated" on a row only when that time reads differently from the
// creation time, a coin toss on a merge request Renovate edits within a second.
async function mergeRequestListFrame (frameName, project, waitText, { projectNames = null, height } = {}) {
  await gitlabFrame(I, frameName, `${gitlabUrl.project(project)}/-/merge_requests?sort=title_asc`, {
    waitText, height, projectNames, textMasks: TOOLBOX_MASK, hide: ['[data-testid="issuable-timestamp"]']
  })
}

// ---------------------------------------------------------------------------
// Chapter 1: a generated project only receives the toolbox update
// ---------------------------------------------------------------------------

storyboardStep(Given, 'the project deploys its own image, pinned at 0.2.0 in its staging manifest', async () => {
  story = { pubs: [], dirs: [] }
  const suffix = crypto.randomBytes(4).toString('hex')
  story.toolboxDir = buildToolbox()
  story.toolbox = await publishToGitLab(story.toolboxDir, { name: `e2e-renovate-toolbox-${suffix}`, project: { jobs_enabled: false } })
  story.pubs.push(story.toolbox)
  pushTags(story.toolboxDir, story.toolbox)

  const dir = story.projectDir = renderProjectFromTemplate(`${BASE_URL}/${projectPath(story.toolbox.projectName)}.git`, '1.0.0')
  story.dirs.push(dir)
  fs.writeFileSync(path.join(dir, OWN_DEPENDENCY.file), `${OWN_DEPENDENCY.pin}\n`)
  git(dir, 'add', '-A')
  git(dir, 'commit', '--quiet', '--no-verify', '-m', 'feat: depend on toml')
  const name = `e2e-renovate-project-${suffix}`
  const image = `localhost:${OWN_IMAGE.port}/${projectPath(name)}` // DevSkim: ignore DS162092 -- The suite's own test registry on the local network; never a deployed endpoint.
  fs.mkdirSync(path.dirname(path.join(dir, OWN_IMAGE.overlay)), { recursive: true })
  fs.writeFileSync(path.join(dir, OWN_IMAGE.overlay), [
    'apiVersion: kustomize.config.k8s.io/v1beta1',
    'kind: Kustomization',
    'images:',
    `  - name: ${image}`,
    `    newTag: ${OWN_IMAGE.pinned}`,
    ''
  ].join('\n'))
  git(dir, 'add', '-A')
  git(dir, 'commit', '--quiet', '--no-verify', '-m', `feat: deploy ${OWN_IMAGE.pinned} to staging`)
  story.project = await publishToGitLab(dir, { name, project: { jobs_enabled: false } })
  story.pubs.push(story.project)
  await forbidMerges(story.project.projectName, story.project.headers)
  await forbidMerges(story.toolbox.projectName, story.toolbox.headers)
  story.registry = await startRegistry(projectPath(story.project.projectName))

  // The size GitLab prints after the file's name moves by a fraction of a
  // pixel from one load to the next, and says nothing the card is about.
  await gitlabFrame(I, 'downstream-own-image', gitlabUrl.file(story.project.projectName, 'main', OWN_IMAGE.overlay), {
    waitText: 'newTag', height: 600, hide: ['.file-header-content small']
  })
  // Twin: the main branch deploys the image at 0.2.0, one release behind.
  const overlay = await getRepositoryFile(story.project.projectName, OWN_IMAGE.overlay, 'main', story.project.headers)
  if (!overlay.includes(`  - name: ${image}\n    newTag: ${OWN_IMAGE.pinned}\n`)) throw new Error(`The staging overlay must pin ${image} at ${OWN_IMAGE.pinned}:\n${overlay}`)
})

storyboardStep(When, 'Renovate runs on a project generated from an older toolbox release, it opens only the toolbox update and the toml update', async () => {
  const entries = story.projectLog = await runRenovate(story.projectDir, story.project.projectName, story.project.token, DOWNSTREAM_RUN_ENV)
  story.projectMrs = await openMergeRequests(story.project.projectName, story.project.headers)
  await mergeRequestListFrame('downstream-merge-requests', story.project.projectName, 'update dependency toml', { height: 440 })

  // Twins: Renovate scanned the answers file and project/, nothing else,
  // opened exactly the two merge requests, and marked neither of them red.
  assertSameList('Files the generated project\'s Renovate scanned', packageFilesOf(entries).map(pf => pf.packageFile), DOWNSTREAM_FILES)
  assertSameList('Merge requests Renovate opened on the generated project', story.projectMrs.map(mr => mr.title), [
    'fix(deps): update dependency toml to v0.10.2',
    'fix(devsecops): update devsecops toolbox to v1.0.1'
  ])
  for (const mr of story.projectMrs) {
    const statuses = (await freshGet(`${BASE_URL}/api/v4/projects/${encodedProjectPath(story.project.projectName)}/repository/commits/${mr.sha}/statuses`, story.project.headers)).data
    const failed = (Array.isArray(statuses) ? statuses : []).filter(status => status.status === 'failed').map(status => status.name)
    if (failed.length) throw new Error(`"${mr.title}" carries a failed check: ${failed.join(', ')}`)
  }
  // Twin: Renovate never even looked the project's own image up.
  if (story.registry.requests.length) throw new Error(`Renovate looked up the project's own image in its deployment manifest: ${story.registry.requests.join(', ')}`)
})

storyboardStep(Then, 'the toolbox update brings the newer tool pins with it, and no stray VERSION file', async () => {
  const { projectName, headers } = story.project
  const mr = story.projectMrs.find(item => /devsecops toolbox/i.test(item.title))
  const changes = await mergeRequestChanges(projectName, mr.iid, headers)
  await changesFrame('downstream-toolbox-update', projectName, mr.iid, '.config/node/version', { height: 680 })

  // Twins: exactly the release's files (so no stray VERSION), no artifact
  // error (Renovate would mark the merge request red and comment on it), and
  // the branch really holds release 1.0.1.
  assertSameList('Files the toolbox update changes', changes.map(change => change.new_path), TOOLBOX_UPDATE_FILES)
  const artifactErrors = story.projectLog.filter(entry => entry.msg === 'artifactErrors')
  if (artifactErrors.length) throw new Error(`Renovate failed to update the toolbox update's artifacts: ${JSON.stringify(artifactErrors.map(entry => entry.artifactErrors))}`)
  const answers = await getRepositoryFile(projectName, ANSWERS, mr.source_branch, headers)
  if (!/^_commit: 1\.0\.1$/m.test(answers)) throw new Error(`The toolbox update must record release 1.0.1:\n${answers}`)
  for (const [file, version] of Object.entries(RELEASES['1.0.1'])) {
    const shown = (await getRepositoryFile(projectName, file, mr.source_branch, headers)).trim()
    if (shown !== version) throw new Error(`${file} must read ${version} on the toolbox update, it reads ${shown}`)
  }
})

// ---------------------------------------------------------------------------
// Chapter 2: a generated project's own minor and patch updates share one
// merge request
// ---------------------------------------------------------------------------

storyboardStep(Given, "the developer adds nose 1.2.1 and oauth2client 3.0.0 to the project's own dependencies", async () => {
  const { projectName, headers } = story.project
  const pins = [OWN_DEPENDENCY.pin, ...MORE_DEPENDENCIES]
  fs.writeFileSync(path.join(story.projectDir, OWN_DEPENDENCY.file), `${pins.join('\n')}\n`)
  git(story.projectDir, 'add', OWN_DEPENDENCY.file)
  git(story.projectDir, 'commit', '--quiet', '--no-verify', '-m', 'feat: depend on nose and oauth2client')
  story.project.push()

  await gitlabFrame(I, 'downstream-more-dependencies', gitlabUrl.file(projectName, 'main', OWN_DEPENDENCY.file), {
    waitText: 'oauth2client', height: 500, hide: ['.file-header-content small']
  })
  // Twin: the main branch pins the three dependencies.
  const shown = await getRepositoryFile(projectName, OWN_DEPENDENCY.file, 'main', headers)
  if (shown !== `${pins.join('\n')}\n`) throw new Error(`${OWN_DEPENDENCY.file} on the main branch must pin ${pins.join(', ')}:\n${shown}`)
})

// The one update branch Renovate's log gives a dependency.
function updateBranch (deps, name) {
  const branches = (deps[name] || { branches: new Set() }).branches
  if (branches.size !== 1) throw new Error(`${name} must get exactly one update branch, got ${JSON.stringify([...branches])}`)
  return [...branches][0]
}

storyboardStep(When, 'Renovate runs on the project again, the minor and patch updates of toml and nose share one merge request, and the major update of oauth2client gets its own', async () => {
  const { projectName, token, headers } = story.project
  const entries = await runRenovate(story.projectDir, projectName, token, DOWNSTREAM_RERUN_ENV)
  const mrs = await openMergeRequests(projectName, headers)
  await mergeRequestListFrame('downstream-grouped-merge-requests', projectName, 'oauth2client', { height: 440 })

  // Twins: three merge requests, the toolbox update still on its own; toml
  // and nose on one branch, oauth2client on another; each merge request
  // opened from the branch Renovate's log names.
  assertSameList('Merge requests on the generated project after its second Renovate run', mrs.map(mr => mr.title), [
    GROUP.title,
    MAJOR.title,
    'fix(devsecops): update devsecops toolbox to v1.0.1'
  ])
  const deps = dependencies(packageFilesOf(entries))
  const group = updateBranch(deps, 'toml')
  if (updateBranch(deps, 'nose') !== group) throw new Error(`toml and nose must share one branch, got ${group} and ${updateBranch(deps, 'nose')}`)
  const major = updateBranch(deps, 'oauth2client')
  if (major === group) throw new Error(`The major update of oauth2client must not ride in ${group}`)
  story.groupMr = mrs.find(mr => mr.title === GROUP.title)
  story.majorMr = mrs.find(mr => mr.title === MAJOR.title)
  if (story.groupMr.source_branch !== group) throw new Error(`"${GROUP.title}" must come from ${group}, it comes from ${story.groupMr.source_branch}`)
  if (story.majorMr.source_branch !== major) throw new Error(`"${MAJOR.title}" must come from ${major}, it comes from ${story.majorMr.source_branch}`)
})

// Twins of a merge request on project/requirements.txt: that file only, and
// exactly these lines in and out.
async function assertRequirementsMove (mr, { added, removed }) {
  const changes = await mergeRequestChanges(story.project.projectName, mr.iid, story.project.headers)
  assertSameList(`Files "${mr.title}" changes`, changes.map(change => change.new_path), [OWN_DEPENDENCY.file])
  const lines = changes[0].diff.split('\n')
  assertSameList(`Lines "${mr.title}" adds`, lines.filter(line => line.startsWith('+')), added)
  assertSameList(`Lines "${mr.title}" removes`, lines.filter(line => line.startsWith('-')), removed)
}

storyboardStep(Then, 'the project dependencies merge request moves toml and nose together, and leaves oauth2client to its own merge request', async () => {
  await changesFrame('downstream-project-dependencies', story.project.projectName, story.groupMr.iid, OWN_DEPENDENCY.file, { height: 440 })
  await assertRequirementsMove(story.groupMr, GROUP)
  await assertRequirementsMove(story.majorMr, MAJOR)
})

// ---------------------------------------------------------------------------
// Chapter 3: the toolbox groups its own small updates, and keeps the tools
// its tests see apart
// ---------------------------------------------------------------------------

storyboardStep(When, "the toolbox's own Renovate runs, it groups its small updates and keeps playwright apart", async () => {
  const { projectName, token, headers } = story.toolbox
  const entries = await runRenovate(story.toolboxDir, projectName, token, TOOLBOX_RUN_ENV)
  story.toolboxMrs = await openMergeRequests(projectName, headers)
  await mergeRequestListFrame('toolbox-merge-requests', projectName, 'update dependency playwright', { projectNames: [], height: 560 })

  const deps = dependencies(packageFilesOf(entries))
  // Twin: every bootstrap tool is seen at both places it is pinned, so one
  // update moves both, never only one.
  for (const tool of TOOLS) {
    const files = (deps[tool.depName] || { files: new Set() }).files
    for (const file of [tool.source, INSTALL_SH]) {
      if (!files.has(file)) throw new Error(`Renovate does not see ${tool.depName} in ${file} (found in: ${[...files].join(', ') || 'nowhere'})`)
    }
  }
  // Twin: each dependency gets exactly one update branch, at its one release.
  story.toolboxBranches = {}
  for (const [name, version] of Object.entries(UPDATES)) {
    const found = deps[name] || { branches: new Set(), versions: new Set() }
    if (found.branches.size !== 1) throw new Error(`${name} must get exactly one update branch, got ${JSON.stringify([...found.branches])}`)
    story.toolboxBranches[name] = [...found.branches][0]
    if (![...found.versions].some(v => v.endsWith(version.replace(/^v/, '')))) {
      throw new Error(`${name} must be proposed at ${version}, got ${JSON.stringify([...found.versions])}`)
    }
  }
  // Twin: the small updates share the group's branch, the tools the tests
  // see each keep a branch of their own, and each branch is one merge request.
  for (const name of GROUPED) {
    if (!GROUP_BRANCH.test(story.toolboxBranches[name])) {
      throw new Error(`${name} must ride in the toolbox dependencies group, got the branch ${story.toolboxBranches[name]}`)
    }
  }
  const apart = APART.map(name => story.toolboxBranches[name])
  if (new Set(apart).size !== APART.length || apart.some(branch => GROUP_BRANCH.test(branch))) {
    throw new Error(`playwright and its test image must keep a branch each, out of the group: ${JSON.stringify(apart)}`)
  }
  assertSameList('Branches of the merge requests the toolbox\'s Renovate opened', story.toolboxMrs.map(mr => mr.source_branch), [...new Set(Object.values(story.toolboxBranches))])

  // Twin of the playwright skew: the test image installs the browser its own
  // playwright asks for, and that browser is really there.
  const dockerfile = fs.readFileSync(path.join(REPO, '.config/codeceptjs/Dockerfile'), 'utf8')
  if (!/playwright install/.test(dockerfile)) throw new Error('.config/codeceptjs/Dockerfile installs no browser: a playwright bump would leave the runner without one')
  const browser = execFileSync('node', ['-e', "console.log(require('playwright').chromium.executablePath())"], { cwd: '/app/.config/codeceptjs', encoding: 'utf8' }).trim()
  fs.accessSync(browser, fs.constants.X_OK)
})

function toolboxMergeRequest (depName) {
  const mr = story.toolboxMrs.find(item => item.source_branch === story.toolboxBranches[depName])
  if (!mr) throw new Error(`No merge request for ${depName}`)
  return mr
}

// Twins of a Changes card: the grouped merge request changes exactly the
// files of its updates, and these `files` move to `version`.
function assertMovesTogether (what, changes, files, version) {
  assertSameList('Files the grouped update changes', changes.map(change => change.new_path), GROUP_FILES)
  for (const change of changes.filter(change => files.includes(change.new_path))) {
    if (!change.diff.split('\n').some(line => line.startsWith('+') && line.includes(version))) {
      throw new Error(`${change.new_path} must move to ${version} in the ${what} update:\n${change.diff}`)
    }
  }
}

// Twin: before the pin-back, each install.sh pin equals its .config source.
function assertInstallerMatchesSources () {
  const installer = fs.readFileSync(path.join(REPO, INSTALL_SH), 'utf8')
  for (const tool of TOOLS) {
    const pinned = (installer.match(new RegExp(`^${tool.pinVar}="(?:copier==)?([^"]+)"`, 'm')) || [])[1]
    const source = fs.readFileSync(path.join(REPO, tool.source), 'utf8')
    const canonical = tool.depName === 'copier' ? (source.match(/copier==([0-9][0-9.]*)/) || [])[1] : source.trim()
    if (!pinned || pinned !== canonical) {
      throw new Error(`install.sh pins ${tool.pinVar}="${pinned}" but ${tool.source} says ${canonical}: the installer drifted from the framework`)
    }
  }
}

storyboardStep(Then, 'the copier update moves its config pin and its installer pin together', async () => {
  const { projectName, headers } = story.toolbox
  const mr = toolboxMergeRequest('copier')
  const changes = await mergeRequestChanges(projectName, mr.iid, headers)
  await changesFrame('toolbox-copier-update', projectName, mr.iid, INSTALL_SH, { projectNames: [], height: 640 })
  assertMovesTogether('copier', changes, COPIER_FILES, `copier==${UPDATES.copier}`)
  assertInstallerMatchesSources()
})

storyboardStep(Then, 'the MegaLinter update moves the local pin and both CI pins together', async () => {
  const { projectName, headers } = story.toolbox
  const mr = toolboxMergeRequest('oxsecurity/megalinter')
  const changes = await mergeRequestChanges(projectName, mr.iid, headers)
  await changesFrame('toolbox-megalinter-update', projectName, mr.iid, '.config/megalinter/package.json', { projectNames: [], height: 980 })
  assertMovesTogether('MegaLinter', changes, MEGALINTER_FILES, UPDATES['oxsecurity/megalinter'])
})

// ---------------------------------------------------------------------------
// @renovate-nightly: on the main branch, a push pipeline leaves Renovate to
// the project's nightly schedule
// ---------------------------------------------------------------------------

// What the feedback job of a pipeline on the project's main branch has, the
// pipeline source aside. The job runs in the suite's own checkout, the
// framework the project would carry.
function feedbackJobEnv (pub) {
  return {
    ...process.env,
    CI: 'true',
    CI_COMMIT_BRANCH: 'main',
    CI_API_V4_URL: `${BASE_URL}/api/v4`,
    CI_PROJECT_ID: String(pub.projectId),
    TASK_RENOVATE_PLATFORM: 'gitlab',
    TASK_RENOVATE_ENDPOINT: `${BASE_URL}/api/v4`,
    TASK_RENOVATE_TOKEN: pub.token,
    TASK_RENOVATE_REPOSITORY: projectPath(pub.projectName)
  }
}

// Off camera: the same job, read as plain text.
function runFeedbackJob (pub, source) {
  try {
    return execFileSync('task', ['devsecops:feedback:renovate'], {
      cwd: REPO, env: { ...feedbackJobEnv(pub), CI_PIPELINE_SOURCE: source }, encoding: 'utf8', stdio: 'pipe', timeout: RENOVATE_TIMEOUT_MS
    })
  } catch (e) {
    throw new Error(`The ${source} pipeline's feedback job failed:\n${(e.stdout || '') + (e.stderr || '')}`)
  }
}

const WAITS = 'Renovate waits for this project\'s pipeline schedule'
const RENOVATE_RAN = 'Repository finished'

function assertRenovate (what, output, ran) {
  if (output.includes(RENOVATE_RAN) !== ran) {
    throw new Error(`${what} must ${ran ? '' : 'not '}run Renovate:\n${output.slice(-3000)}`)
  }
  if (output.includes(WAITS) === ran) {
    throw new Error(`${what} must ${ran ? 'not ' : ''}say "${WAITS}":\n${output.slice(-3000)}`)
  }
}

storyboardStep(Given, 'a project on GitLab with a nightly pipeline schedule', async () => {
  story = { pubs: [], dirs: [] }
  const dir = tempDir('e2e-renovate-nightly')
  fs.writeFileSync(path.join(dir, 'README.md'), '# A project with a nightly schedule\n')
  // CI stays on, or GitLab refuses the schedule: with no .gitlab-ci.yml the
  // project still starts no pipeline.
  const pub = await publishToGitLab(dir, { name: `e2e-renovate-nightly-${crypto.randomBytes(4).toString('hex')}` })
  story.pubs.push(pub)
  const created = await freshPost(`${BASE_URL}/api/v4/projects/${pub.projectId}/pipeline_schedules`,
    { description: 'Renovate', ref: 'main', cron: '0 1 * * *', cron_timezone: 'Europe/Paris' }, pub.headers)
  if (created.status >= 400) throw new Error(`Creating the nightly schedule returned ${created.status}: ${JSON.stringify(created.data)}`)
  story.nightly = { pub, scheduleId: created.data.id }
})

storyboardStep(Then, 'a push pipeline leaves Renovate to the schedule, and only the scheduled pipeline runs it', async () => {
  const { pub, scheduleId } = story.nightly
  assertRenovate('A push pipeline on main, with a schedule,', runFeedbackJob(pub, 'push'), false)
  const close = await openLocalTerminal(I, { cwd: REPO, env: feedbackJobEnv(pub), port: 7696, height: 560 })
  try {
    const screen = await terminalCard(I, 'renovate-nightly-push', 'CI_PIPELINE_SOURCE=push task devsecops:feedback:renovate')
    assertRenovate('A push pipeline on main, with a schedule,', screen, false)
  } finally {
    await close()
  }
  assertRenovate('The scheduled pipeline', runFeedbackJob(pub, 'schedule'), true)
  const deleted = await freshDelete(`${BASE_URL}/api/v4/projects/${pub.projectId}/pipeline_schedules/${scheduleId}`, pub.headers)
  if (deleted.status >= 400) throw new Error(`Deleting the nightly schedule returned ${deleted.status}`)
  assertRenovate('A push pipeline on main, without a schedule,', runFeedbackJob(pub, 'push'), true)
})
