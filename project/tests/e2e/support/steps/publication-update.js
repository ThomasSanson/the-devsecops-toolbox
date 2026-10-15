/* global inject Before After Given When Then document */
/**
 * A toolbox release reaching a component-only project: @publication-update.
 *
 * The fixture is a REAL two-release template built from the working branch: tag
 * 1.0.0 is this branch as it stands, tag 1.0.1 adds a rule to the publication
 * floor, a line to the update machinery, and a line to a tool the project never
 * installed. It is pushed to the test GitLab and installed from there by the
 * REAL installer function (scaffold_publication_only, sourced from
 * .config/devsecops/install.sh), so what the story updates is what a developer
 * really gets, from where a developer really gets it.
 *
 * Nothing here types the update. `task feedback` runs Renovate (the pinned one
 * in this image, against the real GitLab), Renovate opens the merge request and
 * applies the release inside it, and the story reads the main branch once that
 * merge request is in. Five cards: the publication folder on GitLab, the dry run
 * in the terminal, the merged merge request, the same folder page after it, and
 * the same dry run after a pull. Every card has a programmatic twin.
 *
 * Two things the whole story depends on, both found the hard way:
 *   - `copier` must be on PATH when Renovate runs, or its own copier manager
 *     dies on a spawn error and the process never exits. The framework's CI job
 *     installs it for exactly this reason;
 *   - Renovate can only track a template it can reach over http, so the
 *     two-release template lives in GitLab and not in a directory.
 */
const crypto = require('crypto')
const fs = require('fs')
const { execSync } = require('child_process')
const { I, GitLabUserPage } = inject()
const {
  shellEscape,
  runCommand,
  containerName,
  execInContainer,
  execInContainerAsUser,
  removeContainer,
  waitForTtyd,
  stripAnsiEscapeSequences
} = require('../helpers/docker')
const { openTerminal, terminalCard } = require('../terminal/capture')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const { gitlabUrl, gitlabFrame, inNewTab } = require('../helpers/gitlabCard')
const { copyFramework } = require('../helpers/frameworkCopy')
const { freshGet } = require('../helpers/http')
const {
  BASE_URL,
  encodedProjectPath,
  getRootHeaders,
  createProject,
  deleteProject,
  createLambdaPersonalAccessToken,
  revokePersonalAccessToken,
  listProjectMergeRequests,
  getMergeRequest,
  mergeMergeRequest,
  listProjectBranches,
  listRepositoryTree
} = require('../helpers/gitlabApi')

const WORKSPACE = '/workspace'
const PROJECT_DIR = '/workspace/my-project'
const INSTALLER_LIB = '/tmp/installer-lib.sh'
const OLD_RELEASE = '1.0.0'
const NEW_RELEASE = '1.0.1'
const SETUP_TIMEOUT = 600000
// Where the suite's own container keeps the checkout it runs `task feedback`
// from. Renovate clones the repository itself; this is only the working copy the
// command is typed in, the way a CI job has one. It also reads the merged main
// branch back for the twins of the GitLab cards.
const CHECKOUT_DIR = '/tmp/publication-update-checkout'
// How long the merge request may take to settle as merged, and how often to ask.
const MERGE_DEADLINE_MS = 120000
const MERGE_POLL_SECONDS = 2

// What the 1.0.1 release changes, one file per audience:
//   - the publication floor the project HAS, and must receive;
//   - the update machinery itself, part of the spine the project HAS;
//   - a tool the project never installed, and must NOT receive.
const NEW_FLOOR_RULE = '*.kubeconfig'
const SPINE_FILE = '.config/copier/Taskfile.yml'
const SPINE_MARKER = '# 1.0.1: the update machinery gained a note'
const ABSENT_TOOL = '.config/glab/Taskfile.yml'
// Exactly what the release must move in this project.
const RELEASE_FILES = ['.config/devsecops/.copier-answers.yml', SPINE_FILE, '.config/publication/denylist.base'].sort()
// The credential the project happens to track, published today and held back
// once the release tightens the floor.
const CREDENTIAL = 'src/cluster.kubeconfig'

// The folder both repository cards show, the team's own files in it, and the
// commit that installed it all.
const PUBLICATION_DIR = '.config/publication'
const TEAM_FILES = ['allowlist', 'denylist', 'manifest', 'owners']
const INSTALL_COMMIT = 'chore: install source publication and our own rules'
// Everything a publication-only install puts in .config: the component and the
// spine that keeps it up to date. No linter, no container or forge tooling.
const SPINE = ['copier', 'devsecops', 'publication', 'python', 'renovate', 'task']

// Tall enough for the Files panel with .config and publication unfolded, down
// to the project's last root file.
const FOLDER_PAGE_HEIGHT = 940
// The sidebar's open work items and merge requests counters: Renovate's
// Dependency Dashboard issue moves the first one, GitLab refreshes them from a
// cache on its own schedule, and no card is about them.
const SIDEBAR_COUNTERS = '[data-testid="pill-badge"]'
// The author's avatar in the last-commit box. The shared mask only blanks it,
// and a blank avatar of "The team" (no GitLab account) leaves a gap the
// account of the release commit does not: the before and after cards would
// not line up.
const LAST_COMMIT_AVATAR = '.project-last-commit .avatar, .project-last-commit .gl-avatar'
// The template's per-run name, in the source branch Renovate names after it
// and in the answers file the merge request changes.
const TOOLBOX_MASK = [/e2e-toolbox-[0-9a-f]+/g, 'toolbox']
// The number of framework files sitting outside the allowlist is real, and it
// moves whenever the spine gains or loses a file. The card must not rot on it.
const TERMINAL_MASKS = [
  [/\b\d+ other tracked files\b/g, '<n> other tracked files'],
  [/e2e-component-[0-9a-f]+/g, 'project']
]
// The last card's typed line: the team pulls the merged main branch, then asks
// the same question as before the release.
const PULL_AND_CHECK = 'git pull -q origin main && task publication:check'

const ownsScenario = test => Boolean(test && test.tags && test.tags.includes('@publication-update'))
const lambdaUser = () => process.env.TASK_GITLAB_LAMBDA_USER
const tokenHeaders = () => ({ 'PRIVATE-TOKEN': global.pubUpdateToken })

function repositoryUrl (project, token) {
  const url = new URL(`/${lambdaUser()}/${project}.git`, BASE_URL)
  if (token) {
    url.username = lambdaUser()
    url.password = token
  }
  return url.href
}

Before(test => {
  if (!ownsScenario(test)) return
  global.pubUpdateContainer = null
  global.pubUpdateTemplate = null
  global.pubUpdateToolbox = null
  global.pubUpdateProject = null
  global.pubUpdateToken = null
  global.pubUpdateTokenId = null
})

After(async test => {
  if (!ownsScenario(test)) return
  const resources = {
    container: global.pubUpdateContainer,
    template: global.pubUpdateTemplate,
    projects: [global.pubUpdateProject, global.pubUpdateToolbox],
    tokenId: global.pubUpdateTokenId
  }
  // A later scenario can start while API cleanup is pending.
  global.pubUpdateContainer = null
  global.pubUpdateTemplate = null
  global.pubUpdateProject = null
  global.pubUpdateToolbox = null
  global.pubUpdateTokenId = null
  global.pubUpdateToken = null
  removeContainer(resources.container)
  for (const dir of [resources.template, CHECKOUT_DIR]) {
    if (!dir || !dir.startsWith('/tmp/')) continue
    try {
      execSync(`rm -rf ${shellEscape(dir)}`, { stdio: 'ignore' })
    } catch (_) {
      // Best-effort cleanup.
    }
  }

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
  if (resources.tokenId) {
    try {
      await revokePersonalAccessToken(resources.tokenId, rootHeaders)
    } catch (_) {
      // Best-effort.
    }
  }
})

function sh (cmd, cwd) {
  return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: SETUP_TIMEOUT, encoding: 'utf8' })
}

/**
 * The working branch, tagged as two consecutive toolbox releases. 1.0.1 carries
 * the three changes the story reads back, so "a new release arrived" is a real
 * template diff and not a fixture pretending to be one. copyFramework leaves out
 * .git and the suite's own screenshots, which no render reads: the template that
 * GitLab, the installer and Renovate each clone stays light.
 */
function buildTwoReleaseTemplate () {
  const tpl = `/tmp/publication-release-${crypto.randomBytes(4).toString('hex')}`
  sh(`mkdir -p ${tpl}`)
  copyFramework(tpl)
  // The extracted tree keeps the host's uid, and git refuses a repository
  // owned by another user.
  sh(`chown -R "$(id -u):$(id -g)" ${tpl}`)
  sh('git init --quiet --initial-branch=main', tpl)
  sh('git config user.email "e2e@test.local" && git config user.name "E2E"', tpl)
  sh('git add -A', tpl)
  sh(`git commit --quiet --no-verify -m "chore: toolbox release ${OLD_RELEASE}"`, tpl)
  sh(`git tag ${OLD_RELEASE}`, tpl)

  sh(`printf '%s\\n' ${shellEscape(NEW_FLOOR_RULE)} >> .config/publication/denylist.base`, tpl)
  sh(`printf '\\n%s\\n' ${shellEscape(SPINE_MARKER)} >> ${SPINE_FILE}`, tpl)
  sh(`printf '\\n# 1.0.1: a change in a tool this project never installed\\n' >> ${ABSENT_TOOL}`, tpl)
  sh('git add -A', tpl)
  sh(`git commit --quiet --no-verify -m "chore: toolbox release ${NEW_RELEASE}"`, tpl)
  sh(`git tag ${NEW_RELEASE}`, tpl)
  return tpl
}

/**
 * A live terminal on a project installed by the REAL installer at release 1.0.0:
 * the component plus the spine that keeps it up to date, the team's own rules,
 * and a little source tree with a cluster credential in it.
 */
function setupUpdateTerminal (templateUrl, pushUrl, credential) {
  const name = containerName()
  runCommand(`cd ${WORKSPACE}/project && docker compose run -d --name ${shellEscape(name)} ubuntu`, { timeout: SETUP_TIMEOUT })

  // The installer's own file, stripped of its `main` invocation so the
  // component function can be called directly: the story installs with the
  // product, never with a copy of it.
  runCommand(
    `docker cp ${shellEscape(`${WORKSPACE}/.config/devsecops/install.sh`)} ${shellEscape(`${name}:/tmp/install.sh`)}`
  )
  const own = execInContainer(name, 'chown bootstrap:bootstrap /tmp/install.sh', { user: 'root' })
  if (own.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to hand the installer to the bootstrap user:\n${own.output}`)
  }

  const setup = execInContainerAsUser(name, 'bootstrap', [
    'set -e',
    'export PATH="$HOME/.local/bin:$PATH"',
    'mkdir -p "$HOME/.local/bin"',
    `grep -v '^main "' /tmp/install.sh > ${INSTALLER_LIB}`,
    // task and uv come from the installer's own installers: no duplicated
    // download path, and their volatile output stays off camera.
    `sh -c ". ${INSTALLER_LIB}; install_task; install_uv" >/dev/null 2>&1`,
    'git config --global user.email "team@test.local"',
    'git config --global user.name "The team"',
    'git config --global init.defaultBranch main',
    "git config --global --add safe.directory '*'",
    // The token lives in the credential store, never in a remote URL: a card
    // that ever shows this project's remotes must not show a token.
    'git config --global credential.helper store',
    `printf '%s\n' ${shellEscape(credential)} > "$HOME/.git-credentials"`,
    'chmod 600 "$HOME/.git-credentials"',
    `mkdir -p ${PROJECT_DIR} && cd ${PROJECT_DIR}`,
    // THE REAL INSTALLER, at the old release, from the template as GitLab
    // serves it — which is also what the answers file records, and what Renovate
    // will later ask for new tags.
    `DEVSECOPS_TEMPLATE_URL=${shellEscape(templateUrl)} DEVSECOPS_TEMPLATE_VCS_REF=${OLD_RELEASE} ` +
      `sh -c ". ${INSTALLER_LIB}; scaffold_publication_only" >/dev/null 2>&1`,
    // The team's own source, and the rules they wrote themselves.
    'mkdir -p src',
    "printf '# Field Reporting\\n' > README.md",
    "printf 'serve()\\n' > src/app.js",
    "printf 'apiVersion: v1\\nclusters: []\\n' > src/cluster.kubeconfig",
    "printf '# What may be published.\\n/README.md\\n/src/**\\n' > .config/publication/allowlist",
    "printf '# Who approves what becomes public.\\nsecurity-lead\\n' > .config/publication/owners",
    'git init -q -b main .',
    'git add -A',
    `git commit -q --no-verify -m ${shellEscape(INSTALL_COMMIT)}`,
    `git remote add origin ${shellEscape(pushUrl)}`,
    'git push -q origin main',
    // CI runners exec under umask 000, so every directory created here comes out
    // world-writable and `ls` colours it green-on-green instead of the plain blue
    // a 0755 directory gets. A permission drift, not a rendering one, and it
    // breaks a listing baseline between a laptop and the runner.
    `find ${PROJECT_DIR} -type d -exec chmod 755 {} + 2>/dev/null || true`,
    `find ${PROJECT_DIR} -type f -not -path '*/.git/*' -exec chmod 644 {} + 2>/dev/null || true`,
    `chmod 755 ${PROJECT_DIR}/.config/publication/publish.sh`
  ].join('\n'), { timeout: SETUP_TIMEOUT })
  if (setup.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to set up the component-only project:\n${setup.output}`)
  }

  const ttydStart = execInContainerAsUser(name, 'bootstrap', [
    'export PATH="$HOME/.local/bin:$PATH"',
    `cd ${PROJECT_DIR} && nohup ttyd -p 7681 -W -t scrollback=5000 -t rendererType=dom bash >/tmp/ttyd.log 2>&1 &`,
    'sleep 1'
  ].join('\n'))
  if (ttydStart.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to start ttyd:\n${ttydStart.output}`)
  }

  waitForTtyd(name, 30000)
  return name
}

function inProject (script) {
  return execInContainerAsUser(global.pubUpdateContainer, 'bootstrap', `cd ${PROJECT_DIR} && ${script}`)
}

function inProjectOrThrow (script) {
  const res = inProject(script)
  if (res.exitCode !== 0) {
    throw new Error(`Command failed in the project (\`${script}\`):\n${res.output}`)
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

/** Push the two-release template to GitLab: Renovate only tracks what it can fetch. */
function pushTemplate (dir, url) {
  sh(`git push --quiet ${shellEscape(url)} main --tags`, dir)
}

/**
 * The .config/publication folder of the main branch on GitLab, the card that
 * opens and closes the update. GitLab unfolds the Files panel down to the
 * folder by itself. Its Last commit column fills row by row, so the card waits
 * until every row has one. The folder's README renders under the table: 460
 * lines of documentation no card is about, and every edit of it would redden
 * both cards, so it is hidden, like the sidebar counters and the commit
 * author's avatar.
 */
async function publicationFolderFrame (frameName, waitText) {
  await gitlabFrame(I, frameName, gitlabUrl.tree(global.pubUpdateProject, 'main', PUBLICATION_DIR), {
    waitText,
    height: FOLDER_PAGE_HEIGHT,
    textMasks: [TOOLBOX_MASK],
    hide: ['.readme-holder', LAST_COMMIT_AVATAR, SIDEBAR_COUNTERS],
    prepare: () => I.waitForFunction(() => {
      const rows = Array.from(document.querySelectorAll('table.tree-table tbody tr')).filter(row => row.querySelector('th'))
      return rows.length > 0 && rows.every(row => {
        const cell = row.querySelector('td')
        return cell && cell.textContent.trim()
      })
    }, 60)
  })
}

/** The remote .config holds the spine and the component, nothing else. */
async function assertOnlyTheSpine (what) {
  const res = await listRepositoryTree(global.pubUpdateProject, tokenHeaders(), '?ref=main&path=.config&per_page=100')
  const names = (res.data || []).map(entry => entry.name).sort()
  if (JSON.stringify(names) !== JSON.stringify(SPINE)) {
    throw new Error(`${what}: .config on the main branch must hold exactly ${JSON.stringify(SPINE)}, it holds ${JSON.stringify(names)}`)
  }
}

/**
 * Wait for the merge request to be merged (by the API call or by Renovate's
 * automerge, whichever came first) and, when it asked for it, for its source
 * branch to be deleted: GitLab does that after the merge, and the card must not
 * catch the header halfway.
 */
async function waitForMerged (iid) {
  const deadline = Date.now() + MERGE_DEADLINE_MS
  let mr = null
  while (Date.now() < deadline) {
    mr = (await getMergeRequest(global.pubUpdateProject, iid, tokenHeaders())).data || {}
    if (mr.state === 'merged') {
      if (!mr.force_remove_source_branch && !mr.should_remove_source_branch) return mr
      const branches = (await listProjectBranches(global.pubUpdateProject, tokenHeaders())).data || []
      if (!branches.some(branch => branch.name === mr.source_branch)) return mr
    }
    await I.wait(MERGE_POLL_SECONDS)
  }
  throw new Error(`The update merge request never settled as merged: ${JSON.stringify({ state: mr && mr.state, branch: mr && mr.source_branch })}`)
}

/**
 * `task feedback` — the phase the nightly schedule runs — in a checkout of the
 * project, with the environment a CI job would have. Its output is no card,
 * only a twin (exit code 0, "Renovate started", no artifactErrors): the card
 * is the merged merge request on GitLab.
 *
 * `copier` on PATH is not optional: Renovate's own copier manager spawns it, and
 * on a missing binary the run dies on an unhandled rejection and hangs. The
 * framework's feedback job installs it for the same reason.
 */
function runFeedback (cloneUrl, token) {
  const pin = fs.readFileSync(`${WORKSPACE}/.config/copier/requirements.txt`, 'utf8').trim()
  sh(`rm -rf ${CHECKOUT_DIR} && git clone --quiet ${shellEscape(cloneUrl)} ${CHECKOUT_DIR}`)
  sh(`uv tool install --quiet ${shellEscape(pin)}`)
  const env = [
    'PATH="$HOME/.local/bin:$PATH"',
    'TASK_RENOVATE_PLATFORM=gitlab',
    `TASK_RENOVATE_REPOSITORY=${lambdaUser()}/${global.pubUpdateProject}`,
    `TASK_RENOVATE_ENDPOINT=${shellEscape(new URL('/api/v4', BASE_URL).href)}`,
    `TASK_RENOVATE_TOKEN=${token}`
  ].join(' ')
  try {
    const output = execSync(`env ${env} task feedback 2>&1`, {
      cwd: CHECKOUT_DIR, encoding: 'utf8', timeout: SETUP_TIMEOUT, maxBuffer: 64 * 1024 * 1024
    })
    return { output, exitCode: 0 }
  } catch (e) {
    return {
      output: (e.stdout || '') + (e.stderr || ''),
      exitCode: typeof e.status === 'number' ? e.status : 1
    }
  }
}

// Off camera: the lambda user (logged in, the project is private), its token,
// the public two-release template and the private project, installed at 1.0.0
// by the real installer in the terminal container and pushed. On camera: the
// publication folder on GitLab. Then the terminal opens, for the next card.
storyboardStep(Given, 'a project on GitLab that installed source publication and nothing else', async () => {
  // loginAs creates the lambda user when it does not exist yet.
  await GitLabUserPage.loginAs(lambdaUser(), process.env.TASK_GITLAB_LAMBDA_PASSWORD)
  const rootHeaders = await getRootHeaders()
  const suffix = crypto.randomBytes(4).toString('hex')
  global.pubUpdateToolbox = `e2e-toolbox-${suffix}`
  global.pubUpdateProject = `e2e-component-${suffix}`

  const created = await createLambdaPersonalAccessToken(
    `publication-update-${suffix}`, ['api', 'write_repository'], rootHeaders
  )
  if (!created.token) {
    throw new Error(`Failed to mint the lambda token: ${JSON.stringify(created)}`)
  }
  global.pubUpdateToken = created.token
  global.pubUpdateTokenId = created.id

  // The template is public, the way a template is: copier and Renovate both read
  // it without a credential. The project itself is private, and runs no CI: no
  // runner is registered for it, and a pipeline nobody picks up would sit
  // spinning in the merge request this story photographs.
  for (const [name, extra] of [
    [global.pubUpdateToolbox, { visibility: 'public' }],
    [global.pubUpdateProject, { visibility: 'private', jobs_enabled: false }]
  ]) {
    const res = await createProject({ name, ...extra }, tokenHeaders())
    if (res.status >= 400) {
      throw new Error(`Failed to create ${name}: ${res.status} ${JSON.stringify(res.data)}`)
    }
  }

  const credentials = new URL(BASE_URL)
  credentials.username = lambdaUser()
  credentials.password = global.pubUpdateToken

  global.pubUpdateTemplate = buildTwoReleaseTemplate()
  pushTemplate(global.pubUpdateTemplate, repositoryUrl(global.pubUpdateToolbox, global.pubUpdateToken))
  global.pubUpdateContainer = setupUpdateTerminal(
    repositoryUrl(global.pubUpdateToolbox),
    repositoryUrl(global.pubUpdateProject),
    credentials.href
  )

  await publicationFolderFrame('update-before', INSTALL_COMMIT)
  await assertOnlyTheSpine('a component-only install')
  mustContain(inProjectOrThrow('grep _commit .config/devsecops/.copier-answers.yml'), `_commit: ${OLD_RELEASE}`,
    'the project must record the release it came from')

  await openTerminal(I, global.pubUpdateContainer)
})

storyboardStep(Given, 'what it would publish today, cluster credential included', async () => {
  const screen = await terminalCard(I, 'update-check-before', 'task publication:check', { mask: TERMINAL_MASKS })
  mustContain(screen, ['Publishing 3 files', CREDENTIAL, 'README.md'],
    'before the release, the credential is among the files that would be published')
})

// task feedback runs Renovate, Renovate opens the merge request; the API merges
// it unless Renovate's automerge (on by default) got there first. The card is
// the merged merge request on its Changes tab, taken in a second tab so the
// terminal keeps its session. The twins: the feedback output, the merge
// request's own list of changed files, and its merged state.
storyboardStep(When, 'the feedback task runs, Renovate opens a merge request that applies the new release, and that merge request goes into the main branch', async () => {
  const { output, exitCode } = runFeedback(
    repositoryUrl(global.pubUpdateProject, global.pubUpdateToken),
    global.pubUpdateToken
  )
  const log = stripAnsiEscapeSequences(output)
  if (exitCode !== 0) {
    throw new Error(`The feedback phase failed (exit ${exitCode}):\n${log.slice(-6000)}`)
  }
  mustContain(log, ['Feedback', 'Renovate started'], 'the feedback phase must be what starts Renovate')
  mustNotContain(log, ['artifactErrors'], 'Renovate must apply the release without an artifact error')

  // Every state, not only the open ones: automerge may already have merged it.
  const mrs = await listProjectMergeRequests(global.pubUpdateProject, tokenHeaders(), '?state=all')
  const mr = (mrs.data || []).find(m => m.source_branch.startsWith('renovate/'))
  if (!mr) {
    throw new Error(`Renovate opened no merge request. Its output ended with:\n${log.slice(-6000)}`)
  }

  const changes = await freshGet(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(global.pubUpdateProject)}/merge_requests/${mr.iid}/changes`,
    tokenHeaders()
  )
  const paths = ((changes.data && changes.data.changes) || []).map(c => c.new_path).sort()
  if (JSON.stringify(paths) !== JSON.stringify(RELEASE_FILES)) {
    throw new Error(`Renovate's merge request must carry exactly ${JSON.stringify(RELEASE_FILES)}, it carried ${JSON.stringify(paths)}`)
  }

  const merged = await mergeMergeRequest(global.pubUpdateProject, mr.iid, tokenHeaders())
  // 405 is what GitLab answers for a merge request that is already in.
  if (merged.status >= 400 && merged.status !== 405) {
    throw new Error(`The update merge request must go in: ${merged.status} ${JSON.stringify(merged.data)}`)
  }
  await waitForMerged(mr.iid)

  await inNewTab(I, () => gitlabFrame(I, 'update-merge-request', gitlabUrl.mr(global.pubUpdateProject, mr.iid, 'diffs'), {
    waitText: NEW_FLOOR_RULE,
    textMasks: [TOOLBOX_MASK],
    hide: [SIDEBAR_COUNTERS]
  }))
})

// The same page as the Given, after the merge. The twins read the merged main
// branch in the checkout task feedback ran in (git answers "last commit of this
// path" the way GitLab's table does) and the remote .config.
storyboardStep(Then, "on the main branch the team's rules keep their own commit, and nothing the project never installed arrives", async () => {
  sh('git fetch --quiet origin main', CHECKOUT_DIR)
  const git = (args) => sh(`git ${args}`, CHECKOUT_DIR).trim()

  const moved = git('diff --name-only origin/main~1 origin/main').split('\n').filter(Boolean).sort()
  if (JSON.stringify(moved) !== JSON.stringify(RELEASE_FILES)) {
    throw new Error(`The release must change exactly ${JSON.stringify(RELEASE_FILES)} on the main branch, it changed ${JSON.stringify(moved)}`)
  }
  const releaseCommit = git(`log -1 --format=%s origin/main -- ${PUBLICATION_DIR}/denylist.base`)
  if (releaseCommit === INSTALL_COMMIT || !releaseCommit.includes(NEW_RELEASE)) {
    throw new Error(`denylist.base must sit on the release's commit, it sits on "${releaseCommit}"`)
  }
  for (const file of TEAM_FILES) {
    const title = git(`log -1 --format=%s origin/main -- ${PUBLICATION_DIR}/${file}`)
    if (title !== INSTALL_COMMIT) {
      throw new Error(`The release must not touch ${file}, a file the team owns: its last commit is "${title}"`)
    }
  }
  mustContain(git(`show origin/main:${PUBLICATION_DIR}/owners`), 'security-lead',
    "the team's own owners file must be exactly what they wrote")
  let arrived = true
  try {
    git(`cat-file -e origin/main:${ABSENT_TOOL}`)
  } catch (_) {
    arrived = false
  }
  if (arrived) throw new Error(`"${ABSENT_TOOL}" changed in the release and must NOT have arrived in this project`)
  await assertOnlyTheSpine('an update')

  await inNewTab(I, () => publicationFolderFrame('update-after', releaseCommit))
})

// Back on the terminal tab, which kept its session: one typed line pulls the
// merged main branch and runs the same dry run. The twins: the floor holds the
// credential back, and the clone now records 1.0.1 and the new floor rule, and
// still has no file of the tool it never installed.
storyboardStep(Then, 'after a pull, the tightened floor from that release is already in force', async () => {
  const screen = await terminalCard(I, 'update-check-after', PULL_AND_CHECK, { mask: TERMINAL_MASKS })
  mustContain(screen, ['Publishing 2 files', 'Withholding 1 file', CREDENTIAL, 'framework floor'],
    'after the release, the credential must be held back by the framework floor')

  mustContain(inProjectOrThrow('grep _commit .config/devsecops/.copier-answers.yml'), `_commit: ${NEW_RELEASE}`,
    'the pulled update must move the recorded release')
  mustContain(inProjectOrThrow(`cat ${PUBLICATION_DIR}/denylist.base`), NEW_FLOOR_RULE,
    'the release must have added its new rule to the floor')
  if (inProject(`test -e ${ABSENT_TOOL}`).exitCode === 0) {
    throw new Error(`"${ABSENT_TOOL}" changed in the release and must NOT have arrived in this project`)
  }
})
