/* global inject When Then After */
/**
 * Storyboard for @renovate-flow (features/03-evolution/renovate.feature).
 *
 * The real Renovate bot, twice, against the test GitLab, the way the scheduled
 * job runs it: `task renovate TASK_RENOVATE_PLATFORM=gitlab`, with copier on
 * the PATH because the feedback job installs it first.
 *   1. On a project generated from an older release of a toolbox copy: the bot
 *      must open the toolbox update and the project's own update, nothing for
 *      the framework-owned tools, and the toolbox update must carry the release.
 *   2. On that toolbox copy itself, five dependencies pinned back: one merge
 *      request per dependency, each moving every place the dependency is pinned.
 * Every card is a GitLab page (a merge request list, a Changes tab), twinned
 * with the bot's JSON debug log and the GitLab API. Both projects run no CI,
 * and nobody may merge into their main branch: the framework's configs
 * automerge, and GitLab would merge a pipeline-less merge request at once.
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawn, execFileSync } = require('child_process')
const { REPO, toolboxRepository } = require('../helpers/frameworkCopy')
const { renderProjectFromTemplate } = require('../helpers/copierRender')
const { publishToGitLab } = require('../helpers/gitlabProject')
const { gitlabFrame, gitlabUrl } = require('../helpers/gitlabCard')
const { BASE_URL, projectPath, encodedProjectPath, listProjectMergeRequests, getRepositoryFile } = require('../helpers/gitlabApi')
const { freshGet, freshPost, freshDelete } = require('../helpers/http')
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
const DOWNSTREAM_FILES = [ANSWERS, OWN_DEPENDENCY.file]
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
  const { pubs, dirs } = story
  story = null
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

storyboardStep(When, "Renovate runs on a project generated from an older toolbox release, it opens only the toolbox update and the project's own update", async () => {
  story = { pubs: [], dirs: [] }
  const suffix = crypto.randomBytes(4).toString('hex')
  story.toolboxDir = buildToolbox()
  story.toolbox = await publishToGitLab(story.toolboxDir, { name: `e2e-renovate-toolbox-${suffix}`, project: { jobs_enabled: false } })
  story.pubs.push(story.toolbox)
  pushTags(story.toolboxDir, story.toolbox)

  const dir = renderProjectFromTemplate(`${BASE_URL}/${projectPath(story.toolbox.projectName)}.git`, '1.0.0')
  story.dirs.push(dir)
  fs.writeFileSync(path.join(dir, OWN_DEPENDENCY.file), `${OWN_DEPENDENCY.pin}\n`)
  git(dir, 'add', '-A')
  git(dir, 'commit', '--quiet', '--no-verify', '-m', 'feat: depend on toml')
  story.project = await publishToGitLab(dir, { name: `e2e-renovate-project-${suffix}`, project: { jobs_enabled: false } })
  story.pubs.push(story.project)
  await forbidMerges(story.project.projectName, story.project.headers)
  await forbidMerges(story.toolbox.projectName, story.toolbox.headers)

  const entries = story.projectLog = await runRenovate(dir, story.project.projectName, story.project.token)
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
// Chapter 2: the toolbox updates its own tools, one merge request each
// ---------------------------------------------------------------------------

storyboardStep(When, "the toolbox's own Renovate runs, it opens one merge request per dependency", async () => {
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
  // Twin: one branch per dependency, never shared, each opened as a merge request.
  story.toolboxBranches = {}
  const owners = {}
  for (const [name, version] of Object.entries(UPDATES)) {
    const found = deps[name] || { branches: new Set(), versions: new Set() }
    if (found.branches.size !== 1) throw new Error(`${name} must get exactly one update branch, got ${JSON.stringify([...found.branches])}`)
    const branch = [...found.branches][0]
    if (owners[branch]) throw new Error(`${name} and ${owners[branch]} share the branch ${branch}: one dependency, one merge request`)
    owners[branch] = name
    story.toolboxBranches[name] = branch
    if (![...found.versions].some(v => v.endsWith(version.replace(/^v/, '')))) {
      throw new Error(`${name} must be proposed at ${version}, got ${JSON.stringify([...found.versions])}`)
    }
  }
  assertSameList('Branches of the merge requests the toolbox\'s Renovate opened', story.toolboxMrs.map(mr => mr.source_branch), Object.values(story.toolboxBranches))

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

// Twins of a Changes card: exactly these files, each one moved to `version`.
function assertMovesTogether (what, changes, files, version) {
  assertSameList(`Files the ${what} update changes`, changes.map(change => change.new_path), files)
  for (const change of changes) {
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
