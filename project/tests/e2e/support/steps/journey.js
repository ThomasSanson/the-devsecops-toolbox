/* global inject Before After Given When Then NodeFilter */
// cspell:ignore Caddyfile -- the cspell-survival scenario's project word, named in a step comment
/**
 * E2E developer-journey scenarios.
 *
 * These reproduce, in order, the real onboarding a developer experiences
 * against the in-repo TEST GitLab, and capture a REAL terminal (ttyd + xterm)
 * at each deterministic stage — the visual baseline IS the legible contract.
 * The Gherkin scenario dictates the ordering of the journey.
 *
 * Determinism policy:
 *   - VISUAL baseline (tolerance:0, marker-anchored) for stable screens: the
 *     typed install command, each Copier question, the scaffold-complete screen.
 *   - The toolchain install output (git/uv versions, temp dirs, download
 *     progress) is NON-deterministic and is NOT pixel-baselined (raising
 *     tolerance is forbidden). Instead the FULL session is recorded to
 *     /tmp/install.log (kept as an artifact) and the key milestones are
 *     asserted by string presence on that log.
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { I, GitLabMergeRequestPage, GitLabRepositoryPage, GitLabSettingsPage, GitLabAccessTokenPage, GitLabUserPage } = inject()
const {
  ttydPort,
  runCommand,
  shellEscape,
  execInContainerAsUser,
  stripAnsiEscapeSequences
} = require('../helpers/docker')
const {
  BASE_URL,
  projectPath,
  getRootHeaders,
  createProject,
  deleteProject,
  listProjectBranches,
  listProjectMergeRequests,
  listProjectAccessTokens,
  createLambdaPersonalAccessToken,
  revokePersonalAccessToken,
  listRepositoryTree,
  readProjectVariable,
  listPipelineJobs,
  getMergeRequest,
  mergeMergeRequest,
  putRepositoryFile,
  getRepositoryFile
} = require('../helpers/gitlabApi')
const {
  registerScopedRunner,
  teardownScopedRunner,
  waitMergeRequestPipeline,
  waitRefPipeline,
  dumpFailedTraces
} = require('../helpers/pipelineRunner')
const { freshGet } = require('../helpers/http')
const {
  CONTAINER_WORKDIR,
  PROJECT_DIR,
  INSTALL_LOG,
  WRAPPER_PATH,
  setupClonedProjectTerminal,
  setupBareMachineTerminal,
  setupToolboxUpdateTerminal,
  prepareWorkingBranchInstaller,
  preinstallToolchain,
  authenticateGlab,
  teardownJourneyTerminal
} = require('../helpers/journeyContainer')
const {
  typeCommandAndWait,
  waitForTerminalText,
  waitForTerminalSettle,
  waitForPromptReturn,
  captureTerminalFrame,
  terminalScreenText,
  openTerminal,
  terminalCard,
  clearTerminal,
  scrollTerminalToBottom,
  buildCompactTerminalCapture,
  removeCompactTerminalCapture,
  TERMINAL_NOISE_PATTERNS,
  COMPACT_CAPTURE_ID,
  COMMAND_TIMEOUT_MS
} = require('../terminal/capture')
const { CARD_MAX_HEIGHT, gitlabUrl, gitlabFrame, settlePage, unfoldFileTree, inNewTab } = require('../helpers/gitlabCard')
const { TASKFILE_LINE_RELEASED } = require('../helpers/copierRender')
// The storyboard API ships with the template (.config/codeceptjs/) so
// generated projects use the exact same step-side helpers.
const {
  storyboardStep,
  addStoryboardFrame,
  capturePageFrame,
  frameOutputPath
} = require('../../../../../.config/codeceptjs/storyboard')

const E2E_OUTPUT = path.resolve(__dirname, '..', '..', '_output')

function resetJourneyState () {
  global.journeyContainer = null
  global.journeyProjectName = null
  global.journeyLambdaToken = null
  global.journeyLambdaTokenId = null
  global.journeyMergeRequestIid = null
  // The scoped runner the framework-MR chapter registers on the fly (descriptor
  // { runnerId, runnerToken, svc } — torn down surgically by its own token).
  global.journeyRunner = null
  global.journeyPipelineId = null
}

Before(resetJourneyState)

// Release what a journey holds: its installer log (kept as a debug artifact),
// its container, its GitLab project, its PAT and its runner. The After hook
// calls it, and so does a story that opens a second journey mid-scenario
// (@merge-request-safety, chapter 2), so the first one never leaks.
async function releaseJourney () {
  // Async cleanup can overlap the next scenario. Keep its resources locally
  // and clear shared state before any await, so it cannot erase the next project.
  const { journeyContainer, journeyProjectName, journeyLambdaTokenId, journeyRunner } = global
  resetJourneyState()
  // Save the full installer log as a debug artifact (best-effort) so a failing
  // run can be diagnosed from the complete output, alongside the visual diffs.
  // The file is named after the per-scenario project so parallel workers (and
  // mocha retries) never overwrite the log of the scenario that failed.
  if (journeyContainer) {
    try {
      const logName = `install-${journeyProjectName || journeyContainer}.log`
      const dest = path.join(E2E_OUTPUT, 'install-logs', logName)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      runCommand(`docker cp ${shellEscape(`${journeyContainer}:${INSTALL_LOG}`)} ${shellEscape(dest)}`)
    } catch (_) {
      // No installer log for this scenario (e.g. blank-repo only) — ignore.
    }
  }

  teardownJourneyTerminal(journeyContainer)

  if (journeyProjectName) {
    try {
      const rootHeaders = await getRootHeaders()
      await deleteProject(journeyProjectName, rootHeaders)
    } catch (_) {
      // Best-effort cleanup — GitLab deletion is async and non-critical.
    }
  }

  // Revoke the per-scenario lambda PAT so credentials do not accumulate on
  // the persistent test-GitLab volume across runs.
  if (journeyLambdaTokenId) {
    try {
      const rootHeaders = await getRootHeaders()
      await revokePersonalAccessToken(journeyLambdaTokenId, rootHeaders)
    } catch (_) {
      // Best-effort cleanup.
    }
  }

  // Surgically unregister ONLY this scenario's runner token (never
  // --all-runners) so @daily-contribution, which shares the same compose service
  // locally, keeps its own registration and its running job.
  if (journeyRunner) {
    try {
      const rootHeaders = await getRootHeaders()
      await teardownScopedRunner(journeyRunner, rootHeaders)
    } catch (_) {
      // Best-effort cleanup.
    }
  }
}

After(releaseJourney)

// ============================================
// GIVEN — environment setup
// ============================================

// `setupTerminal(projectName, lambdaToken)` decides what the container starts
// from: the plain clone of the blank project (the installer journeys), or a
// project already generated from an older release and pushed (manual update).
// `projectExtra` adds create-project fields: { initialize_with_readme: true }
// gives main a README commit, so the clone already has a main branch.
async function createJourneyProject (setupTerminal = setupClonedProjectTerminal, projectExtra = {}) {
  const rootHeaders = await getRootHeaders()
  const projectName = `e2e-journey-${crypto.randomBytes(4).toString('hex')}`
  global.journeyProjectName = projectName

  // Empty by default (no README) under the lambda namespace, so the cloned
  // working tree is genuinely blank ("No commits yet").
  const { token: lambdaToken, id: lambdaTokenId } = await createLambdaPersonalAccessToken(
    `journey-${projectName}`,
    ['api', 'write_repository'],
    rootHeaders
  )
  global.journeyLambdaToken = lambdaToken
  global.journeyLambdaTokenId = lambdaTokenId
  const created = await createProject(
    { name: projectName, visibility: 'public', initialize_with_readme: false, ...projectExtra },
    { 'PRIVATE-TOKEN': lambdaToken }
  )
  if (created.status >= 400) {
    throw new Error(`Failed to create project "${projectName}" (status ${created.status}): ${JSON.stringify(created.data)}`)
  }

  global.journeyContainer = setupTerminal(projectName, lambdaToken)
}

async function openBlankProjectTerminal (setupTerminal = setupClonedProjectTerminal, projectExtra = {}) {
  await createJourneyProject(setupTerminal, projectExtra)
  I.amOnPage(`http://${global.journeyContainer}:${ttydPort()}`) // DevSkim: ignore DS162092,DS137138 -- Ephemeral test terminal on the local Compose network.
  I.waitForElement('.xterm-screen', 10)
  I.wait(3)
}

// openBlankProjectTerminal, prepareWorkingBranchInstaller, preinstallToolchain
// and authenticateGlab are now called directly from the storyboard Given steps
// (installer / piped / init-framework-mr / agent-mode); their former plain
// Given bindings were removed with the storyboard migration.

// ============================================
// WHEN — drive the live terminal
// ============================================

// ============================================
// Toolbox-update storyboard — @toolbox-update.
// A project generated from an older toolbox release (22.0.0) sits on GitLab
// with the developer's own commit on top: a task of their own, and the word it
// brings to the spell checker, added to the one shared dictionary file of that
// release. The developer runs `task devsecops:update` in their terminal, the
// new release (22.7.1) arrives as a merge request, then a changed answer
// (Ansible on) is pushed to the same merge request. Six cards are real GitLab
// pages, two are the developer's terminal. Every card is twinned with REST on
// the branches, the commits and the merge request, or with the terminal's own
// words, so a regression fails loud even without eyes.
// ============================================

const UPDATE_BRANCH = 'update-framework-devsecops'
const ANSWERS_FILE = '.config/devsecops/.copier-answers.yml'
const TASK_FILE = 'project/Taskfile.yml'
const OLD_TOOLBOX_VERSION = '22.0.0'
const NEW_TOOLBOX_VERSION = '22.7.1'
const GENERATED_COMMIT = 'chore: project generated from an earlier toolbox release'
const UPDATE_TITLE = `chore(deps): update devsecops toolbox to ${NEW_TOOLBOX_VERSION}`

// The developer's own commit on the main branch, made before the push: a task
// at the end of their task file, and the word it brings to the spell checker
// at the end of config.json, the only dictionary file release 22.0.0 has.
const DEVELOPER_WORD = 'Caddyfile'
const DEVELOPER_TASK = 'project:operate:caddy:reload'
const DEVELOPER_COMMIT = 'feat: add a task that reloads Caddy'
const DEVELOPER_CHANGE = {
  message: DEVELOPER_COMMIT,
  commands: [
    `tmp=$(mktemp) && jq --arg w ${DEVELOPER_WORD} '.words += [$w]' .config/cspell/config.json > "$tmp" && mv "$tmp" .config/cspell/config.json`,
    `printf '\\n  %s:\\n    desc: Reload Caddy after an edit to its Caddyfile\\n    cmds:\\n      - caddy reload --config Caddyfile\\n' ${DEVELOPER_TASK} >> ${TASK_FILE}`
  ]
}

// The release, file by file, as the merge request lists it: true for a new file.
const UPDATE_CHANGES = {
  '.config/cspell/config.base.json': true,
  '.config/cspell/config.json': false,
  '.config/cspell/config.project.json': true,
  '.config/cspell/migrate-words.py': true,
  [ANSWERS_FILE]: false,
  '.gitlab-ci.yml': false
}
// Folded on the card, for room: the framework's word list, the shared file's
// new wiring (its twin reads it on the branch) and the migration script.
const FOLDED_DIFFS = ['.config/cspell/config.base.json', '.config/cspell/config.json', '.config/cspell/migrate-words.py']
// What the Ansible answer adds to the merge request. Nothing under project/.
const ANSIBLE_CHANGES = [
  '.config/ansible/Taskfile.yml',
  '.config/ansible/ansible.cfg',
  '.config/ansible/requirements.txt',
  '.config/ansible-lint/config.yaml',
  'Taskfile.yml'
]

// One typed line on the update branch: the same release again with one answer
// changed, then the new files committed and pushed to the merge request. The
// terminal holds 157 columns at 1440 px, so the line wraps right before the
// commit message, never inside a word.
const ANSIBLE_COMMIT = 'chore: turn the Ansible option on'
const ANSIBLE_RUN = `task copier:update TASK_COPIER_CLI_OPTS='--defaults --data ansible_enabled=true' && git add -A && git commit -q -m '${ANSIBLE_COMMIT}' && git push -q`
const UPDATE_RUN_TIMEOUT_MS = 300000

// go-task echoes the whole uvx command line behind the update task, pinned
// copier and all, and that echo IS part of what the developer sees — it says
// which tool the update actually ran. Only the number in it moves, roughly
// monthly, breaking a card about a toolbox release with a copier release. So
// the line stays and the version freezes. The project's random name, in the
// push and the merge-request link, shows as "project" like on every GitLab card.
const COPIER_PIN_MASK = [[/copier==[0-9][\w.]*/g, 'copier==<version>']]
const runMasks = () => [...COPIER_PIN_MASK, [new RegExp(global.journeyProjectName, 'g'), 'project']]

// The line counters of a Changes tab (+N −N per file, and the total): the
// framework's word list in config.base.json grows every few days, and these
// numbers with it. The file list and its new or changed icons stay.
const DIFF_COUNTERS = ['.file-row-stats', '.diff-stats-contents > div:has([data-testid="js-file-addition-line"])']

// The main branch's head when the story opens: nobody may move it.
let mainHeadSha = null

async function projectApi (route) {
  const res = await freshGet(
    `${BASE_URL}/api/v4/projects/${encodeURIComponent(projectPath(global.journeyProjectName))}${route}`,
    await getRootHeaders()
  )
  if (res.status >= 400) throw new Error(`GET ${route}: HTTP ${res.status}`)
  return res.data
}

async function rawFile (file, ref) {
  return getRepositoryFile(global.journeyProjectName, file, ref, await getRootHeaders())
}

function expectIn (text, needles, what) {
  for (const needle of needles) {
    const found = needle instanceof RegExp ? needle.test(text) : String(text).includes(needle)
    if (!found) throw new Error(`Expected ${what} to contain ${needle}:\n${text}`)
  }
}

// The merge request's files once its diff covers `paths`: GitLab builds a merge
// request's diff in the background after each push.
async function mergeRequestChanges (paths) {
  const deadline = Date.now() + 120000
  for (;;) {
    const changes = (await projectApi(`/merge_requests/${global.journeyMergeRequestIid}/changes`)).changes || []
    const listed = changes.map(c => c.new_path)
    if (paths.every(p => listed.includes(p))) return changes
    if (Date.now() > deadline) throw new Error(`Merge request !${global.journeyMergeRequestIid} never listed ${JSON.stringify(paths)}, found ${JSON.stringify(listed)}`)
    await I.wait(3)
  }
}

// The Changes tab of the update merge request as one 1440 x 1100 card: the
// file list on the left, the diffs on the right. GitLab 19.4 draws it with
// Rapid Diffs (beta) by default, whose stream fails past the fifth file of this
// merge request ("Error streaming diffs: Devise could not find the
// Warden::Proxy" in GitLab's log, a red "Could not fetch all changes" on the
// page). The card asks for GitLab's standard view, the one GitLab itself falls
// back to on that error. That view draws only the diffs in sight, so the
// reload loop reads the file list: the diff is built in the background after a
// push, and the page is reloaded until the list names exactly `files`.
// `fold` closes the diffs too long to read on a card, by their own chevron,
// the way a reviewer does, and `focus` is the diff the card is about: the
// reviewer clicks it last, so GitLab frames it in blue and highlights it in the
// file list.
async function mergeRequestChangesFrame (frameName, files, { fold = [], focus = null } = {}) {
  const url = `${gitlabUrl.mr(global.journeyProjectName, global.journeyMergeRequestIid, 'diffs')}?rapid_diffs_disabled=true`
  const names = JSON.stringify(files.map(f => f.split('/').pop()).sort())
  const listed = async () => JSON.stringify(await I.executeScript(() => Array.from(document.querySelectorAll('[data-testid="file-row"]:not(.folder)'))
    .map(row => row.getAttribute('aria-label')).sort()))
  // One click on a diff's chevron, from the page itself (the pointer would
  // leave a tooltip behind), until its button reads `label`.
  const toggle = async (file, label) => {
    const button = `.diff-file[data-path="${file}"] .file-header-content button`
    await I.waitForElement(button, 30)
    await I.executeScript((selector) => document.querySelector(selector).click(), button)
    // waitForFunction hands its argument array over as ONE argument.
    await I.waitForFunction(([selector, wanted]) => {
      const el = document.querySelector(selector)
      return Boolean(el) && el.getAttribute('aria-label') === wanted
    }, [button, label], 10)
  }
  await gitlabFrame(I, frameName, url, {
    waitText: UPDATE_TITLE,
    height: CARD_MAX_HEIGHT,
    hide: DIFF_COUNTERS,
    prepare: async () => {
      const deadline = Date.now() + 120000
      for (;;) {
        let seen = ''
        for (let i = 0; i < 10; i++) {
          seen = await listed()
          if (seen === names) break
          await I.wait(1)
        }
        if (seen === names) break
        if (Date.now() > deadline) throw new Error(`The Changes tab never listed ${names}, found ${seen}`)
        await I.refreshPage()
        await settlePage(I)
      }
      for (const file of fold) await toggle(file, 'Show file contents')
      if (focus) {
        await toggle(focus, 'Show file contents')
        await toggle(focus, 'Hide file contents')
      }
    }
  })
}

storyboardStep(Given, "a developer's toolbox project sits on GitLab with only its main branch", async () => {
  await ensureLambdaUser()
  // CI off: the generated .gitlab-ci.yml would start a pipeline on every push,
  // on runners the other stories need, and its state would repaint every card.
  await createJourneyProject((name, token) => setupToolboxUpdateTerminal(name, token, {
    commitMessage: GENERATED_COMMIT,
    ownCommit: DEVELOPER_CHANGE
  }), { builds_access_level: 'disabled' })
  await gitlabFrame(I, 'branches-before', gitlabUrl.branches(global.journeyProjectName), { waitText: DEVELOPER_COMMIT })
  await assertBranchExists('main')
  await assertBranchAbsent(UPDATE_BRANCH)
  await assertNoOpenMr()
  const main = (await projectApi('/repository/branches/main')).commit
  if (main.title !== DEVELOPER_COMMIT) throw new Error(`Expected main to end on "${DEVELOPER_COMMIT}", found "${main.title}"`)
  mainHeadSha = main.id
  // What release 22.0.0 put on the main branch: its number, its CI image, and
  // one dictionary file.
  expectIn(await rawFile(ANSWERS_FILE, 'main'), [`_commit: ${OLD_TOOLBOX_VERSION}`], `${ANSWERS_FILE} on main`)
  expectIn(await rawFile('.gitlab-ci.yml', 'main'), [`the-devsecops-toolbox:${OLD_TOOLBOX_VERSION}`], '.gitlab-ci.yml on main')
  const dictionary = (await projectApi('/repository/tree?ref=main&path=.config/cspell')).map(e => e.name)
  if (JSON.stringify(dictionary) !== JSON.stringify(['config.json'])) {
    throw new Error(`Expected .config/cspell to hold only config.json on main, found ${JSON.stringify(dictionary)}`)
  }
})

storyboardStep(Given, 'the developer has pushed their own spelling word and their own task to the main branch', async () => {
  await gitlabFrame(I, 'developer-commit', gitlabUrl.commit(global.journeyProjectName, mainHeadSha), {
    waitText: 'No related merge requests found',
    height: 1000,
    prepare: () => I.waitForFunction(() => document.querySelectorAll('diff-file details[open]').length === 2, 30)
  })
  const diff = await projectApi(`/repository/commits/${mainHeadSha}/diff`)
  const paths = diff.map(d => d.new_path).sort()
  if (JSON.stringify(paths) !== JSON.stringify(['.config/cspell/config.json', TASK_FILE])) {
    throw new Error(`Expected the developer's commit to change config.json and ${TASK_FILE}, it changes ${JSON.stringify(paths)}`)
  }
  expectIn(diff.find(d => d.new_path === '.config/cspell/config.json').diff, [`+    "${DEVELOPER_WORD}"`], 'the dictionary diff')
  expectIn(diff.find(d => d.new_path === TASK_FILE).diff, [`+  ${DEVELOPER_TASK}:`], 'the task file diff')
})

// The terminal opens 1440 wide (159 columns, so go-task's echo of the copier
// command fits on one row) and tall enough for the whole run, and keeps that
// size for both terminal cards: the GitLab cards in between open in a second tab.
storyboardStep(When, 'the developer asks for the new toolbox release from the main branch', async () => {
  await openTerminal(I, global.journeyContainer, { width: 1440, height: 1200 })
  const screen = await terminalCard(I, 'update-run', 'task devsecops:update', { mask: runMasks(), timeoutMs: UPDATE_RUN_TIMEOUT_MS })
  expectIn(screen, [
    `Updating to template version ${NEW_TOOLBOX_VERSION}`,
    '[cspell migration] moving the project words out of the shared file',
    `Opened merge request ${UPDATE_BRANCH} → main.`
  ], 'the update run')
  const mr = await findOpenMr(UPDATE_BRANCH, 'main')
  if (mr.title !== UPDATE_TITLE) throw new Error(`Expected the merge request "${UPDATE_TITLE}", found "${mr.title}"`)
  if (inProject('git branch --show-current').trim() !== UPDATE_BRANCH) throw new Error(`Expected the terminal on ${UPDATE_BRANCH}`)
  if (inProject('git status --porcelain').trim()) throw new Error('Expected the update to leave nothing uncommitted')
})

storyboardStep(Then, "GitLab holds a merge request that moves the project to the new release and gives the developer's word a file of its own", async () => {
  await inNewTab(I, () => mergeRequestChangesFrame('merge-request-changes', Object.keys(UPDATE_CHANGES), {
    fold: FOLDED_DIFFS,
    focus: '.config/cspell/config.project.json'
  }))
  const changes = await mergeRequestChanges(Object.keys(UPDATE_CHANGES))
  const listed = changes.map(c => c.new_path).sort()
  if (JSON.stringify(listed) !== JSON.stringify(Object.keys(UPDATE_CHANGES).sort())) {
    throw new Error(`Expected the merge request to change exactly ${JSON.stringify(Object.keys(UPDATE_CHANGES))}, it changes ${JSON.stringify(listed)}`)
  }
  for (const change of changes) {
    if (change.new_file !== UPDATE_CHANGES[change.new_path]) throw new Error(`Expected ${change.new_path} new_file=${UPDATE_CHANGES[change.new_path]}`)
  }
  const diffOf = (file) => changes.find(c => c.new_path === file).diff
  expectIn(diffOf('.config/cspell/config.project.json'), [`+    "${DEVELOPER_WORD}"`], 'the config.project.json diff')
  expectIn(diffOf(ANSWERS_FILE), [`-_commit: ${OLD_TOOLBOX_VERSION}`, `+_commit: ${NEW_TOOLBOX_VERSION}`], 'the answers diff')
  expectIn(diffOf('.gitlab-ci.yml'), [/^-.*the-devsecops-toolbox:22\.0\.0/m, /^\+.*the-devsecops-toolbox:22\.7\.1/m], 'the CI image diff')
  // The split itself, read on the update branch: the framework's words without
  // the developer's, the shared file empty and importing the other two.
  const base = JSON.parse(await rawFile('.config/cspell/config.base.json', UPDATE_BRANCH))
  if (base.words.includes(DEVELOPER_WORD)) throw new Error(`Expected config.base.json to leave ${DEVELOPER_WORD} out`)
  const shared = JSON.parse(await rawFile('.config/cspell/config.json', UPDATE_BRANCH))
  if (shared.words.length !== 0 || !['./config.base.json', './config.project.json'].every(i => shared.import.includes(i))) {
    throw new Error(`Expected config.json to hold no words and import the two lists: ${JSON.stringify(shared)}`)
  }
  const own = JSON.parse(await rawFile('.config/cspell/config.project.json', UPDATE_BRANCH))
  if (JSON.stringify(own.words) !== JSON.stringify([DEVELOPER_WORD])) {
    throw new Error(`Expected config.project.json to hold ["${DEVELOPER_WORD}"], found ${JSON.stringify(own.words)}`)
  }
  // The Ansible answer is still off: no Ansible tooling yet.
  const tools = (await projectApi(`/repository/tree?ref=${UPDATE_BRANCH}&path=.config&per_page=100`)).map(e => e.name)
  if (tools.some(name => name.startsWith('ansible'))) throw new Error(`Expected no Ansible tooling before the answer changes, found ${JSON.stringify(tools)}`)
})

storyboardStep(When, 'the developer turns the Ansible option on and pushes the re-run update to the same merge request', async () => {
  const screen = await terminalCard(I, 'ansible-run', ANSIBLE_RUN, { mask: runMasks(), timeoutMs: UPDATE_RUN_TIMEOUT_MS })
  expectIn(screen, ['Copier update completed successfully.'], 'the Ansible run')
  if (inProject('git status --porcelain').trim()) throw new Error('Expected the Ansible run to leave nothing uncommitted')
  const head = (await projectApi(`/repository/branches/${UPDATE_BRANCH}`)).commit
  if (head.title !== ANSIBLE_COMMIT) throw new Error(`Expected ${UPDATE_BRANCH} to end on "${ANSIBLE_COMMIT}", found "${head.title}"`)
})

storyboardStep(Then, 'the same merge request now also brings the Ansible tooling', async () => {
  const paths = [...Object.keys(UPDATE_CHANGES), ...ANSIBLE_CHANGES]
  await inNewTab(I, () => mergeRequestChangesFrame('merge-request-ansible', paths))
  const changes = await mergeRequestChanges(paths)
  const listed = changes.map(c => c.new_path).sort()
  if (JSON.stringify(listed) !== JSON.stringify([...paths].sort())) {
    throw new Error(`Expected the merge request to change exactly ${JSON.stringify(paths)}, it changes ${JSON.stringify(listed)}`)
  }
  expectIn(changes.find(c => c.new_path === ANSWERS_FILE).diff, ['+ansible_enabled: true'], 'the answers diff')
  expectIn(await rawFile('Taskfile.yml', UPDATE_BRANCH), ['.config/ansible/Taskfile.yml'], 'the root Taskfile.yml')
  const commits = await projectApi(`/merge_requests/${global.journeyMergeRequestIid}/commits`)
  if (commits.length !== 2) throw new Error(`Expected the merge request to carry 2 commits, found ${commits.length}`)
})

storyboardStep(Then, "GitLab's history of the developer's task file shows neither update ever touched it", async () => {
  await inNewTab(I, () => gitlabFrame(I, 'task-file-history', `${gitlabUrl.commits(global.journeyProjectName, UPDATE_BRANCH)}/${TASK_FILE}`, {
    waitText: DEVELOPER_COMMIT
  }))
  const history = await projectApi(`/repository/commits?ref_name=${UPDATE_BRANCH}&path=${encodeURIComponent(TASK_FILE)}`)
  const titles = history.map(c => c.title)
  if (JSON.stringify(titles) !== JSON.stringify([DEVELOPER_COMMIT, GENERATED_COMMIT])) {
    throw new Error(`Expected ${TASK_FILE} to have been changed only by the generation and the developer, found ${JSON.stringify(titles)}`)
  }
  // Release 22.7.1 rewords a line of this file in the template: it must not
  // have reached the project.
  const tasks = await rawFile(TASK_FILE, UPDATE_BRANCH)
  expectIn(tasks, [`  ${DEVELOPER_TASK}:`], `${TASK_FILE} on ${UPDATE_BRANCH}`)
  if (tasks.includes(TASKFILE_LINE_RELEASED)) throw new Error(`Expected the release's edit to ${TASK_FILE} to stay out of the project`)
})

storyboardStep(Then, 'the update branch stands next to a main branch nobody pushed to', async () => {
  await inNewTab(I, () => gitlabFrame(I, 'branches-after', gitlabUrl.branches(global.journeyProjectName), { waitText: UPDATE_BRANCH }))
  await assertBranchExists(UPDATE_BRANCH)
  const main = (await projectApi('/repository/branches/main')).commit
  if (main.id !== mainHeadSha) throw new Error(`Expected main to stay on the developer's commit, it moved to "${main.title}"`)
})

// The installer WHEN bindings (type command / launch / accept-default-and-wait
// per prompt / wait-for-completion) were removed with the storyboard migration:
// the questionnaire is now driven by the @install-complete storyboard
// steps below, which capture each Copier question as its own card. The poll for
// install.sh's completion marker lives in waitForInstallerComplete().

// ============================================
// THEN — proofs
// ============================================

// The milestone-block and install-log plain bindings (used only by the retired
// flat installer/piped scenarios) were removed with the storyboard migration;
// the storyboard steps below assert the install log through assertInstallLog()
// and assertCreatedFilesAtLeast() instead.

// ============================================
// Init-framework-devsecops MR flow (stage 4)
// ============================================

// The first decision the installer asks (gum/glow layer), before any Copier
// question. The full-framework journey accepts it (default affirmative).
const TOOLCHAIN_PROMPT = 'Install gum and glow?'
const SCOPE_PROMPT = 'Install the complete DevSecOps framework?'
const AGENT_DONE_MARKER = 'Agent mode installed.'
// install.sh prints this when the scope resolves to "none" — the exact symptom
// of the multi-select trap (declined the framework, the lone item never toggled).
const NOTHING_MARKER = 'Nothing selected'

const COPIER_PROMPTS = [
  'Do you need Ansible?',
  'Which CI/CD platform are you using?',
  'Runner tags for jobs that need Docker',
  'Which container runtime would you like to use?',
  'Generate a docker-compose.yml file',
  'Can your CI runners start privileged containers',
  'Enable the project workspace?',
  "Publish this project's source",
  'Auto-merge Renovate merge requests',
  'Language for Gherkin test specifications'
]

// Re-open the live terminal (a GitLab-page capture may have navigated away),
// type the installer command and stop at the FIRST decision (the gum/glow scope
// prompt). Split out so a storyboard step can frame the launch before answering.
// `height` (and `width`) open the terminal at that size through openTerminal
// (the big-card stories); without them, the terminal keeps the default window.
// `line` is what the developer types, on camera (an opt-out in front of the
// command, a # label after it).
async function launchWorkingBranchInstaller (stopAt = SCOPE_PROMPT, { height = 0, width, line = `bash ${WRAPPER_PATH}` } = {}) {
  if (height) {
    await openTerminal(I, global.journeyContainer, { height, width })
  } else {
    I.amOnPage(`http://${global.journeyContainer}:${ttydPort()}`) // DevSkim: ignore DS162092,DS137138 -- Ephemeral test terminal on the local Compose network.
    I.waitForElement('.xterm-screen', 10)
    I.wait(2)
  }
  I.click('.xterm-screen')
  I.type(line)
  I.pressKey('Enter')
  await waitForTerminalText(I, stopAt, COMMAND_TIMEOUT_MS)
  await waitForTerminalSettle(I)
}

// Poll install.sh's PERSISTENT log until it prints its final marker. NOT the
// glab sub-installer's "Installation complete!" (that appears earlier): this
// is install.sh's own last line, after scaffolding + `task devsecops:init`
// (dev-environment setup + GitLab config), so it proves the whole run finished.
// Budget calibrated from measured CI traces (2 workers): the worst known-good
// run (merge-request-safety, job 15417477989) took 391540ms; once the suite
// grew, the same two heaviest scenarios (fresh-machine, merge-request-safety)
// overlap for longer and both exceeded the old 600000ms ceiling without
// finishing (job 15419924229). 900000ms keeps ~2.3x margin over the last
// measured good run; the CI job's own 90m timeout easily absorbs it.
async function waitForInstallerComplete (timeoutMs = 900000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = execInContainerAsUser(
      global.journeyContainer, 'bootstrap',
      `grep -c "Run 'task' to see available commands" ${INSTALL_LOG} 2>/dev/null || true`
    )
    if (parseInt((res.output || '0').trim(), 10) > 0) return
    await I.wait(5)
  }
  throw new Error(`Installer did not finish (no "Run 'task' to see available commands" in the log within ${timeoutMs}ms)`)
}

// Accept the complete-framework install (gum confirm binds 'y' to the
// affirmative), accept every Copier question with its default, then wait for
// install.sh's final marker (init: bootstrap main + init-framework-devsecops
// branch + MR + GitLab config, then the completion lines).
async function answerAndCompleteInstaller () {
  // Re-focus the live terminal: in the blank storyboard a capture overlay is
  // built and torn down between the launch and here, so click before answering.
  I.click('.xterm-screen')
  I.pressKey('y')
  for (const prompt of COPIER_PROMPTS) {
    await waitForTerminalText(I, prompt, COMMAND_TIMEOUT_MS)
    I.pressKey('Enter')
  }
  await waitForInstallerComplete()
}

// ============================================
// Agent-mode storyboard — ONE sentence = ONE card = ONE pixel baseline.
// The normative reference story. GitLab opens and closes it on the SAME page
// at the SAME size (the repository page of the main branch, before and after),
// and the terminal in between is ONE tall session: each card shows the whole
// run since the typed command, not a strip of its last lines, and each gum
// menu is caught live, before its answer. Every card is twinned with a
// programmatic check of the same fact (the screen, the install log and the
// working tree in the container, REST on the remote branch), so a regression
// fails loud even without eyes.
// ============================================

const AGENT_COMMIT = 'chore: install the AI agent guardrails'
// The line the developer types after the install, and the card's # Copy.
const AGENT_PUSH = `git add -A && git commit -q -m "${AGENT_COMMIT}" && git push -q origin main && git status`
// Tall enough for the Files panel with .agent, its rules and its skills unfolded.
const AGENT_PAGE_HEIGHT = 1040

// The repository page of main, the Files panel unfolded on `unfold` (folder
// names, outermost first). Public project: the anonymous view, no login.
async function agentRepositoryFrame (frameName, waitText, unfold = []) {
  await gitlabFrame(I, frameName, gitlabUrl.tree(global.journeyProjectName), {
    waitText,
    height: AGENT_PAGE_HEIGHT,
    projectNames: [global.journeyProjectName],
    prepare: () => unfoldFileTree(I, unfold)
  })
}

// Read in the container's clone, the local twin of a card.
function inProject (script) {
  const res = execInContainerAsUser(global.journeyContainer, 'bootstrap', `cd ${PROJECT_DIR} && ${script}`)
  if (res.exitCode !== 0) throw new Error(`\`${script}\` failed in the project:\n${res.output}`)
  return stripAnsiEscapeSequences(res.output || '')
}

function linesOf (text) {
  return text.split('\n').map(line => line.trim()).filter(Boolean).sort()
}

function readInstallLog () {
  return stripAnsiEscapeSequences(
    execInContainerAsUser(global.journeyContainer, 'bootstrap', `cat ${INSTALL_LOG} 2>/dev/null || true`).output || ''
  )
}

// The whole stage in one sentence, closed by its visual proof. Off camera: the
// lambda user, the public README project (Auto DevOps off, so no pipeline ever
// appears on these pages), its clone in the terminal container, the staged
// working-branch installer and its pre-installed toolchain (whose volatile
// output must never reach a frame). On camera: the repository page of main.
storyboardStep(Given, 'a fresh GitLab project with only a README on its main branch', async () => {
  await ensureLambdaUser()
  await createJourneyProject(setupClonedProjectTerminal, { initialize_with_readme: true, auto_devops_enabled: false })
  prepareWorkingBranchInstaller(global.journeyContainer)
  preinstallToolchain(global.journeyContainer)
  await agentRepositoryFrame('agent-mode-gitlab-before', 'Initial commit')
  await assertRootTreeExactly('main', ['README.md'])
  // The clone is the same README and nothing else, with nothing to commit.
  const local = linesOf(inProject('ls -A1'))
  if (JSON.stringify(local) !== JSON.stringify(['.git', 'README.md'])) {
    throw new Error(`Expected the clone to hold only .git and README.md, found ${JSON.stringify(local)}`)
  }
  const status = inProject('git status --porcelain').trim()
  if (status) throw new Error(`Expected a clean clone, git status says:\n${status}`)
})

// The terminal opens tall, and 1440 wide so the push line of card 5 fits on
// one row, before ttyd loads, and keeps that size for the whole session.
// ArrowRight moves the gum focus onto "Choose components", and the card
// catches the question with that answer highlighted, before Enter:
// gum erases a menu the moment it is answered. The twins read the screen: the
// scope card rendered by glow (never its markdown source), and the focus on
// "Choose components" (gum paints the focused button's background). The card
// and the button call the choice by the same name, and no dash stands in for a
// colon.
storyboardStep(When, 'the developer starts the installer and picks "Choose components" instead of the complete framework', async () => {
  await launchWorkingBranchInstaller(SCOPE_PROMPT, { height: 1200, width: 1440 })
  I.pressKey('ArrowRight')
  await waitForTerminalSettle(I)
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-2-choice', { fromMarker: `bash ${WRAPPER_PATH}` }))
  const screen = await terminalScreenText(I)
  if (!screen.includes('• Complete framework') || screen.includes('**')) {
    throw new Error(`Expected the installer's scope card rendered by glow, not its markdown source:\n${screen}`)
  }
  if (!screen.includes('• Choose components') || screen.includes('—')) {
    throw new Error(`Expected the scope card to name the choice "Choose components", like its button, with no dash:\n${screen}`)
  }
  const focused = await I.executeScript(() => Array.from(document.querySelectorAll('.xterm-rows span'))
    .filter(span => span.textContent.includes('Choose components'))
    .some(span => /xterm-bg-212/.test(span.className)))
  if (!focused) throw new Error(`Expected "Choose components" to be the highlighted answer:\n${screen}`)
  I.pressKey('Enter')
})

// The checklist, caught live, as the whole run since the typed command. Its
// twin: the question is gone from the screen and only the AI agent line is
// ticked.
storyboardStep(Then, 'a checklist opens with the AI agent line already ticked', async () => {
  await waitForTerminalText(I, 'Select what to install', COMMAND_TIMEOUT_MS)
  await waitForTerminalSettle(I)
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-3-checklist', { fromMarker: `bash ${WRAPPER_PATH}` }))
  const screen = await terminalScreenText(I)
  if (screen.includes(SCOPE_PROMPT) || !screen.includes('✓ Agent mode') || screen.includes('✓ Source publication')) {
    throw new Error(`Expected the question gone and a checklist with only the AI agent line ticked:\n${screen}`)
  }
  if (screen.includes('—')) throw new Error(`Expected the checklist lines with no dash:\n${screen}`)
})

// Enter takes the ticked line. The installer's own words are the proof, from
// the typed command down to the prompt that came back. The twin reads the
// install log and the working tree: the AI agent files were added, the README
// kept, nothing else.
storyboardStep(Then, 'once the developer confirms the ticked line, the installer installs only the AI agent files', async () => {
  I.pressKey('Enter')
  const deadline = Date.now() + 240000
  let log = ''
  while (Date.now() < deadline) {
    log = readInstallLog()
    if (log.includes(AGENT_DONE_MARKER) || log.includes(NOTHING_MARKER)) break
    await I.wait(2)
  }
  if (!log.includes(AGENT_DONE_MARKER) || log.includes(NOTHING_MARKER)) {
    throw new Error(`The installer never reported "${AGENT_DONE_MARKER}" (tail):\n${log.slice(-1500)}`)
  }
  await waitForPromptReturn(I, `bash ${WRAPPER_PATH}`, 60000)
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-4-installed', { fromMarker: `bash ${WRAPPER_PATH}` }))
  const local = linesOf(inProject('ls -A1'))
  const expected = ['.agent', '.git', 'AGENTS.md', 'CLAUDE.md', 'README.md']
  if (JSON.stringify(local) !== JSON.stringify(expected)) {
    throw new Error(`Expected the working tree to hold exactly ${JSON.stringify(expected)}, found ${JSON.stringify(local)}`)
  }
})

// Agent mode never commits or pushes: the developer does, in the same terminal,
// with ONE typed line (the card's # Copy). The clone's origin already carries
// the token, so nothing secret is ever typed or printed. The twins: before the
// line, the clone still sits on "Initial commit" (agent mode left the commit to
// the developer); after it, git says the branch is up to date with GitLab, and
// GitLab's main branch points at the new commit.
storyboardStep(When, 'the developer commits the new files and pushes them to the main branch', async () => {
  const before = inProject('git log -1 --format=%s').trim()
  if (before !== 'Initial commit') throw new Error(`Expected agent mode to leave the commit to the developer, the clone is on "${before}"`)
  const screen = await terminalCard(I, 'terminal-5-push', AGENT_PUSH)
  for (const said of ["Your branch is up to date with 'origin/main'.", 'nothing to commit, working tree clean']) {
    if (!screen.includes(said)) throw new Error(`Expected git to say "${said}" after the push:\n${screen}`)
  }
  const title = await branchCommitTitle('main')
  if (title !== AGENT_COMMIT) throw new Error(`Expected main to point at "${AGENT_COMMIT}", found "${title}"`)
})

// The same page as the Given, taken in a second tab so the terminal keeps its
// session and its size: the AI agent files on the push's commit, the README
// still on "Initial commit". The twins: the remote tree and no merge request
// opened.
storyboardStep(Then, 'GitLab shows the AI agent files beside the README on the main branch, and nothing else', async () => {
  await inNewTab(I, () => agentRepositoryFrame('agent-mode-gitlab-after', AGENT_COMMIT, ['.agent', 'rules', 'skills']))
  await assertRootTreeExactly('main', ['.agent', 'AGENTS.md', 'CLAUDE.md', 'README.md'])
  const headers = await getRootHeaders()
  const res = await listRepositoryTree(global.journeyProjectName, headers, '?ref=main&path=.agent&per_page=100')
  const names = (res.data || []).map(entry => entry.name)
  for (const dir of ['rules', 'skills', 'workflows']) {
    if (!names.includes(dir)) {
      throw new Error(`Expected the remote .agent tree to contain "${dir}". Entries: ${JSON.stringify(names)}`)
    }
  }
  await assertNoOpenMr()
})

// ============================================
// Reusable REST asserts (the programmatic twin of each storyboard proof).
// Kept as plain functions so the storyboard steps (installer / piped /
// init-framework-mr) and the shared plain bindings (init-baseline /
// release-toggle) all assert the exact same fact.
// ============================================

async function assertBranchExists (branch) {
  const headers = await getRootHeaders()
  const res = await listProjectBranches(global.journeyProjectName, headers)
  const names = (res.data || []).map(b => b.name)
  if (!names.includes(branch)) {
    throw new Error(`Branch "${branch}" not found for ${global.journeyProjectName}. Branches: ${JSON.stringify(names)}`)
  }
}

async function assertBranchAbsent (branch) {
  const headers = await getRootHeaders()
  const res = await listProjectBranches(global.journeyProjectName, headers)
  const names = (res.data || []).map(b => b.name)
  if (names.includes(branch)) {
    throw new Error(`Branch "${branch}" should NOT exist for ${global.journeyProjectName}, but it does. Branches: ${JSON.stringify(names)}`)
  }
}

async function assertNoOpenMr () {
  const headers = await getRootHeaders()
  const res = await listProjectMergeRequests(global.journeyProjectName, headers, '?state=opened')
  const open = res.data || []
  if (open.length > 0) {
    throw new Error(
      `Expected no open merge request for ${global.journeyProjectName}, found ${open.length}: ` +
      JSON.stringify(open.map(m => `${m.source_branch}->${m.target_branch}`))
    )
  }
}

// Locate the open MR source->target, record its iid (the page steps reuse it).
async function findOpenMr (source, target) {
  const headers = await getRootHeaders()
  const res = await listProjectMergeRequests(global.journeyProjectName, headers, '?state=opened')
  const mr = (res.data || []).find(m => m.source_branch === source && m.target_branch === target)
  if (!mr) {
    throw new Error(
      `No open MR ${source} -> ${target} for ${global.journeyProjectName}. ` +
      `Open MRs: ${JSON.stringify((res.data || []).map(m => `${m.source_branch}->${m.target_branch}`))}`
    )
  }
  global.journeyMergeRequestIid = mr.iid
  return mr
}

async function assertMrChangedFiles () {
  const headers = await getRootHeaders()
  const encoded = encodeURIComponent(projectPath(global.journeyProjectName))
  const res = await freshGet(
    `${BASE_URL}/api/v4/projects/${encoded}/merge_requests/${global.journeyMergeRequestIid}/changes`,
    headers
  )
  const changes = (res.data && res.data.changes) || []
  if (changes.length === 0) {
    throw new Error(`Expected MR !${global.journeyMergeRequestIid} to report changed files, found none`)
  }
}

async function assertTokenMaintainer (tokenName) {
  const headers = await getRootHeaders()
  const tokens = await listProjectAccessTokens(global.journeyProjectName, headers)
  const token = (tokens.data || []).find(t => t.name === tokenName && t.active && !t.revoked)
  if (!token) {
    throw new Error(`Active token "${tokenName}" not found for ${global.journeyProjectName}`)
  }
  if (token.access_level < 40) {
    throw new Error(`Token "${tokenName}" has access_level=${token.access_level}, expected >= 40 (Maintainer)`)
  }
}

// The install creates a second token for the update bot; the access-tokens card
// shows both, so the twin proves both are really there (this one carries no
// Maintainer role, only its presence matters).
async function assertTokenExists (tokenName) {
  const headers = await getRootHeaders()
  const tokens = await listProjectAccessTokens(global.journeyProjectName, headers)
  const token = (tokens.data || []).find(t => t.name === tokenName && t.active && !t.revoked)
  if (!token) {
    throw new Error(`Active token "${tokenName}" not found for ${global.journeyProjectName}`)
  }
}

async function assertMainProtected (branch) {
  const headers = await getRootHeaders()
  const encodedPath = encodeURIComponent(projectPath(global.journeyProjectName))
  const branchResponse = await freshGet(
    `${BASE_URL}/api/v4/projects/${encodedPath}/protected_branches/${branch}`,
    headers
  )
  const data = branchResponse.data || {}
  const mergeLevel = (data.merge_access_levels || []).find(l => l.access_level === 40)
  if (!mergeLevel) {
    throw new Error(`Expected merge_access_levels to contain 40 (Maintainers), got: ${JSON.stringify(data.merge_access_levels)}`)
  }
  const pushLevel = (data.push_access_levels || []).find(l => l.access_level === 0)
  if (!pushLevel) {
    throw new Error(`Expected push_access_levels to contain 0 (No one), got: ${JSON.stringify(data.push_access_levels)}`)
  }
}

async function assertMergeMethodFf () {
  const headers = await getRootHeaders()
  const encoded = encodeURIComponent(projectPath(global.journeyProjectName))
  const res = await freshGet(`${BASE_URL}/api/v4/projects/${encoded}`, headers)
  const method = res.data && res.data.merge_method
  if (method !== 'ff') {
    throw new Error(`Expected project merge_method "ff" (fast-forward), got ${JSON.stringify(method)}`)
  }
}

async function assertCommitizenVariable () {
  const headers = await getRootHeaders()
  const res = await readProjectVariable(global.journeyProjectName, 'TASK_COMMITIZEN_TOKEN', headers)
  if (res.status >= 400 || !(res.data && res.data.key === 'TASK_COMMITIZEN_TOKEN')) {
    throw new Error(`Expected CI/CD variable TASK_COMMITIZEN_TOKEN to exist (status ${res.status}): ${JSON.stringify(res.data)}`)
  }
}

// Assert a milestone string is present in the recorded installer session log.
function assertInstallLog (...markers) {
  const log = stripAnsiEscapeSequences(
    execInContainerAsUser(global.journeyContainer, 'bootstrap', `cat ${INSTALL_LOG}`).output || ''
  )
  for (const marker of markers) {
    if (!log.includes(marker)) {
      throw new Error(`Expected the install log to contain ${JSON.stringify(marker)} (tail):\n${log.slice(-1500)}`)
    }
  }
}

// Copier logs one "create <path>" line per scaffolded file; count them to prove
// the full framework (not a partial tree) was rendered.
function assertCreatedFilesAtLeast (min) {
  const cleaned = stripAnsiEscapeSequences(
    execInContainerAsUser(global.journeyContainer, 'bootstrap', `cat ${INSTALL_LOG}`).output || ''
  )
  const count = cleaned.split('\n').filter(line => /^\s*create\s+\S/.test(line)).length
  if (count < min) {
    throw new Error(`Expected Copier to scaffold at least ${min} files, the install log reports ${count}`)
  }
}

// Shared plain bindings (used across features) delegating to the asserts above.
// (the branch / merge-request bindings were removed with the storyboard
// migration — their only caller, piped-install, is now a storyboard that
// twins assertBranchExists / findOpenMr directly.)
Then('a project access token {string} must exist with Maintainer role for the journey project', assertTokenMaintainer)
Then('the branch {string} must be protected with merge for maintainers and push for no one for the journey project', assertMainProtected)

// The root of a branch on GitLab holds EXACTLY these names: the agent-mode
// storyboard's twin of its before and after repository pages.
async function assertRootTreeExactly (branch, expected) {
  const headers = await getRootHeaders()
  const res = await listRepositoryTree(
    global.journeyProjectName,
    headers,
    `?ref=${encodeURIComponent(branch)}&per_page=100`
  )
  const names = (res.data || []).map(entry => entry.name).sort()
  if (JSON.stringify(names) !== JSON.stringify([...expected].sort())) {
    throw new Error(`Expected branch "${branch}" to hold exactly ${JSON.stringify(expected)} at its root, found ${JSON.stringify(names)}`)
  }
}

// ============================================
// Init-framework-MR storyboard (@install-complete, the blank project) — ONE
// sentence = ONE card = ONE pixel baseline. The Given closes the off-camera
// stage (lambda user, cloned terminal, staged installer, glab auth) with its
// visual proof; each Then pairs its page/terminal frame with a programmatic
// REST assert of the SAME fact, so a regression fails loud even without eyes.
// The other delivery cases (main already there, an experiment branch, the
// opt-out) are @merge-request-safety, further down.
// ============================================

// Ensure the lambda user exists (with a password) so the login-gated config
// pages can be captured and the per-scenario PAT can be minted.
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

// Capture a masked GitLab page as a storyboard frame at the storyboard's page
// aspect (1024x640 by default), then restore the default window. `navigate`
// runs the page-object goto+mask; `frameName` is the per-scenario baseline
// stem. Pass `{ height }` to grab a taller viewport when a page has more to
// prove than fits at 640 (e.g. every merge check, or two access tokens).
async function pageFrame (navigate, frameName, opts = {}) {
  I.resizeWindow(1024, opts.height || 640)
  await navigate()
  await maskProjectName(global.journeyProjectName)
  await addStoryboardFrame(I, await capturePageFrame(I, frameName))
  I.resizeWindow(1024, 768)
}

// This story generates its project with a random suffix (e2e-journey-<hex>), and
// GitLab 19 prints the project name in a breadcrumb above EVERY settings page —
// a different card on every run. The page objects each mask their own volatile
// bits; the name belongs to the story, so it is neutralised here, on the one
// road every page card of this story takes.
async function maskProjectName (projectName) {
  if (!projectName) return
  await I.executeScript((name) => {
    const pattern = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    nodes.forEach(n => { n.nodeValue = n.nodeValue.replace(pattern, 'project') })
  }, projectName)
}

// The full masked merge-request overview page — the whole GitLab view a
// reviewer sees (title, state badge, "requested to merge <source> into
// <target>"), not a cropped header band. Reused by the flagship story and the
// toolbox update so every MR card reads as a real page.
async function mrPageFrame (frameName) {
  await pageFrame(
    () => GitLabMergeRequestPage.gotoAndMask(
      projectPath(global.journeyProjectName),
      global.journeyMergeRequestIid,
      global.journeyProjectName
    ),
    frameName
  )
}

// --- Case A: blank project (flagship) ---------------------------------------

storyboardStep(Given, 'a developer has just cloned a brand-new empty project from GitLab', async () => {
  await ensureLambdaUser()
  await openBlankProjectTerminal()
  prepareWorkingBranchInstaller(global.journeyContainer)
  preinstallToolchain(global.journeyContainer)
  authenticateGlab(global.journeyContainer, global.journeyLambdaToken)
  await pageFrame(async () => {
    await I.amOnPage(`/${projectPath(global.journeyProjectName)}`)
    await GitLabRepositoryPage.maskVolatile(global.journeyProjectName)
  }, 'gitlab-empty-project')
})

storyboardStep(When, 'the developer runs the toolbox installer on the blank project', async () => {
  await launchWorkingBranchInstaller()
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-installer-launch', { fromMarker: `bash ${WRAPPER_PATH}` }))
})

storyboardStep(When, 'the installer sets up the framework and says the setup is done', async () => {
  await answerAndCompleteInstaller()
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-installer-complete', { fromMarker: 'Installation complete!' }))
  assertInstallLog('Bootstrapping main', 'init-framework-devsecops', 'Opened merge request', 'Installation complete!')
})

storyboardStep(Then, 'a merge request into main is now waiting for review on GitLab', async () => {
  await findOpenMr('init-framework-devsecops', 'main')
  await mrPageFrame('gitlab-merge-request')
  await assertMrChangedFiles()
})

storyboardStep(Then, 'GitLab now lists main and the new init-framework-devsecops branch', async () => {
  await pageFrame(async () => {
    await I.amOnPage(`/${projectPath(global.journeyProjectName)}/-/branches`)
    await GitLabRepositoryPage.maskVolatile(global.journeyProjectName)
  }, 'gitlab-branches')
  await assertBranchExists('main')
  await assertBranchExists('init-framework-devsecops')
})

storyboardStep(Then, 'GitLab now lets main accept only fast-forward merges', async () => {
  // First login-gated page: authenticate as lambda off-camera, then the
  // subsequent config pages reuse the session.
  await GitLabUserPage.loginAs(process.env.TASK_GITLAB_LAMBDA_USER, process.env.TASK_GITLAB_LAMBDA_PASSWORD)
  await pageFrame(
    () => GitLabSettingsPage.gotoMergeSettingsAndMask(projectPath(global.journeyProjectName), global.journeyProjectName),
    'gitlab-merge-settings',
    // Tall enough to reach the "Merge checks" section: pipelines must succeed
    // and all threads resolved are part of what init locks down.
    { height: 1500 }
  )
  await assertMergeMethodFf()
})

storyboardStep(Then, 'GitLab now refuses pushes straight to main', async () => {
  await pageFrame(
    () => GitLabSettingsPage.gotoProtectedBranchAndMask(projectPath(global.journeyProjectName), global.journeyProjectName),
    'gitlab-protected-branch',
    // Tall enough for the whole main row: allowed to merge (Maintainers),
    // allowed to push (No one) and the force-push toggle.
    { height: 950 }
  )
  await assertMainProtected('main')
})

storyboardStep(Then, 'GitLab now holds an automation token for the project', async () => {
  await pageFrame(
    () => GitLabAccessTokenPage.gotoAccessTokensAndMask(projectPath(global.journeyProjectName)),
    'gitlab-access-tokens',
    { height: 1200 }
  )
  await assertTokenMaintainer('TASK_COMMITIZEN_TOKEN')
  await assertTokenExists('TASK_RENOVATE_TOKEN')
})

storyboardStep(Then, 'GitLab now keeps that token as a CI/CD variable', async () => {
  await pageFrame(
    () => GitLabAccessTokenPage.gotoCiCdAndMask(projectPath(global.journeyProjectName)),
    'gitlab-cicd-variables'
  )
  await assertCommitizenVariable()
})

// ============================================
// @install-complete chapter 4 — "The merge request proves itself".
// The framework MR (init-framework-devsecops -> main, opened by THIS install)
// runs its full pipeline on a project-scoped runner, goes green, and merges into
// main — proving the framework a fresh install ships actually builds and lands
// through review. Each card is a REAL masked GitLab page — the green pipeline
// graph, the "Merged" merge-request header, the file tree on main — with all
// volatile chrome (durations, SHAs, dates, avatars, the pipeline id) masked for
// tolerance:0, twinned with the REST assert that reads the same fact.
// ============================================

// The runner + pipeline machinery (registerScopedRunner / waitMergeRequestPipeline
// / waitRefPipeline / maskPipelinePage / dumpFailedTraces) lives in
// support/helpers/pipelineRunner.js — shared with @daily-contribution, which runs
// a real pipeline the same way on its own shard.

storyboardStep(Then, 'the framework pipeline passes and the merge request merges into main', async () => {
  const rootHeaders = await getRootHeaders()
  global.journeyRunner = await registerScopedRunner(I, global.journeyProjectName, rootHeaders)
  const { pid, status } = await waitMergeRequestPipeline(I, global.journeyProjectName, global.journeyMergeRequestIid, rootHeaders)
  global.journeyPipelineId = pid
  const jobs = pid ? ((await listPipelineJobs(global.journeyProjectName, pid, rootHeaders)).data || []) : []
  jobs.sort((a, b) => a.id - b.id)
  // Twin FIRST: fail loud (with the trace tails) before the merge/capture.
  if (status !== 'success') {
    console.log(`framework pipeline not green (status=${status}); failed: ${jobs.filter(j => j.status === 'failed').map(j => `${j.stage}/${j.name}`).join(', ') || 'none'}`)
    dumpFailedTraces(global.journeyProjectName, jobs, rootHeaders, global.journeyRunner && global.journeyRunner.svc)
    throw new Error(`Expected the framework MR pipeline to pass, got status=${status}`)
  }
  // Twin: the WHOLE generated pipeline ran — all 18 jobs, every one green.
  // 18 since the toolbox ships `no-cheat`: a generated project's merge requests
  // are now read for a switched-off check, and this story is where that count
  // is felt.
  if (jobs.length !== 18) {
    throw new Error(`Expected 18 pipeline jobs, got ${jobs.length}: ${jobs.map(j => j.name).join(', ')}`)
  }
  const notGreen = jobs.filter(j => j.status !== 'success')
  if (notGreen.length) {
    throw new Error(`Expected every job green, these were not: ${notGreen.map(j => `${j.name}=${j.status}`).join(', ')}`)
  }
  // A green pipeline meets main's "pipeline must pass" rule, so the merge goes
  // through — do it and confirm the merged state.
  const lambdaHeaders = { 'PRIVATE-TOKEN': global.journeyLambdaToken }
  const merged = await mergeMergeRequest(global.journeyProjectName, global.journeyMergeRequestIid, lambdaHeaders)
  let state = merged.data && merged.data.state
  for (let i = 0; i < 10 && state !== 'merged'; i++) {
    await I.wait(2)
    const mr = await getMergeRequest(global.journeyProjectName, global.journeyMergeRequestIid, rootHeaders)
    state = mr.data && mr.data.state
  }
  // Twin FIRST: the green pipeline (18 jobs) unblocked the merge, MR is merged.
  if (state !== 'merged') throw new Error(`Expected the framework MR to be merged, got state=${state}`)
  // GitLab removes the source branch asynchronously after accepting the merge.
  // Wait for that result before photographing the merged widget.
  const sourceBranch = merged.data.source_branch
  if (!sourceBranch) throw new Error('The merged request must name its source branch')
  const branchDeletionPollSeconds = 2
  let branches = []
  for (let i = 0; i < 30; i++) {
    const listed = await listProjectBranches(global.journeyProjectName, rootHeaders)
    if (listed.status !== 200) throw new Error(`Could not read the branches after merging: ${listed.status}`)
    branches = (listed.data || []).map(branch => branch.name)
    if (!branches.includes(sourceBranch)) break
    await I.wait(branchDeletionPollSeconds)
  }
  if (branches.includes(sourceBranch)) throw new Error(`Expected the source branch ${sourceBranch} to be deleted by the merge`)
  // ONE proof: the merged merge-request page, full width — the Merged badge,
  // its pipeline shown passed, the branch joined into main.
  I.resizeWindow(1024, 900)
  await GitLabMergeRequestPage.gotoAndMaskMerged(
    projectPath(global.journeyProjectName),
    global.journeyMergeRequestIid,
    global.journeyProjectName
  )
  await I.waitForText('Merged', 30)
  await addStoryboardFrame(I, await capturePageFrame(I, 'framework-mr-merged'))
  I.resizeWindow(1024, 768)
})

storyboardStep(Then, 'main now carries the whole framework, merged through review', async () => {
  const rootHeaders = await getRootHeaders()
  const tree = await listRepositoryTree(global.journeyProjectName, rootHeaders, '?ref=main&per_page=100')
  const names = (tree.data || []).map(e => e.name)
  const want = ['Taskfile.yml', '.gitlab-ci.yml', '.config', '.agent']
  // Twin FIRST: the framework files a fresh install ships are now on main.
  for (const f of want) {
    if (!names.includes(f)) throw new Error(`Expected main to carry "${f}" after the merge. Entries: ${JSON.stringify(names)}`)
  }
  // Show the finality, not a spinner: wait for main's own post-merge pipeline
  // to go green before the shot, so the project page's commit reads success.
  const { pid, status } = await waitRefPipeline(I, global.journeyProjectName, 'main', rootHeaders)
  if (status !== 'success') {
    const jobs = pid ? ((await listPipelineJobs(global.journeyProjectName, pid, rootHeaders)).data || []) : []
    jobs.sort((a, b) => a.id - b.id)
    console.log(`main pipeline not green (status=${status}, pipeline ${pid})`)
    dumpFailedTraces(global.journeyProjectName, jobs, rootHeaders, global.journeyRunner && global.journeyRunner.svc)
    throw new Error(`Expected main's post-merge pipeline to pass, got status=${status}`)
  }
  // The proof is GitLab's own file tree for main, now carrying the whole
  // framework (Taskfile.yml, .gitlab-ci.yml, .config, .agent) with a green
  // commit pipeline, on the masked project page.
  await pageFrame(async () => {
    await I.amOnPage(`/${projectPath(global.journeyProjectName)}`)
    await GitLabRepositoryPage.maskVolatile(global.journeyProjectName)
  }, 'framework-on-main')
})

// ============================================
// Merge-request-safety storyboard — @merge-request-safety. ONE sentence = ONE
// card = ONE pixel baseline, in two chapters, each in its own fresh project.
// Chapter 1: the main branch already exists and the developer runs the
// installer from a local experiment branch with a commit of its own; the
// branches page opens and closes the chapter (before, after), the terminal in
// between shows the experiment and the installer's own words, and the merge
// request's Commits tab shows the one commit it carries. Chapter 2: the opt-out
// typed on camera, then GitLab after it. Every card is paired with a check of
// the same fact (REST, the install log, the clone in the container).
// ============================================

const INIT_BRANCH = 'init-framework-devsecops'
const INIT_COMMIT = 'chore: initialize devsecops framework'
const EXPERIMENT_BRANCH = 'spike/poc'
const EXPERIMENT_COMMIT = 'wip: try an idea'
// One typed line: the experiment branch, a commit of its own, the history. It
// changes a tracked file (README.md, which the scaffold never writes), so the
// installer's switch to the framework branch has something to leave behind.
const EXPERIMENT_LINE = `git switch -c ${EXPERIMENT_BRANCH} && echo idea >> README.md && git commit -am "${EXPERIMENT_COMMIT}" && git log --oneline --all`
const DIRECT_SWITCH = 'TASK_DEVSECOPS_INIT_DIRECT=true'
// The opt-out as typed, labelled; 148 characters with the prompt, so the card
// is wide enough for a full storyboard row.
const DIRECT_LINE = `${DIRECT_SWITCH} bash ${WRAPPER_PATH}   # no review: no branch, no merge request`
// 1440 wide so the experiment line (156 characters with the prompt) never
// wraps; the same terminal for both chapters. The GitLab cards keep the
// standard 900 px: shorter, GitLab scrolls its own sidebar under its header.
const STORY_TERMINAL = { height: 1200, width: 1440 }

// Off camera: a public project of the lambda user (Auto DevOps off, so no
// pipeline status ever reaches these pages), its clone in a terminal
// container, the staged installer, its tools and glab signed in.
async function stageJourney (projectExtra) {
  await createJourneyProject(setupClonedProjectTerminal, { auto_devops_enabled: false, ...projectExtra })
  prepareWorkingBranchInstaller(global.journeyContainer)
  preinstallToolchain(global.journeyContainer)
  authenticateGlab(global.journeyContainer, global.journeyLambdaToken)
}

// The branches page, the before and the after of each chapter.
async function branchesCard (frameName, waitText, prepare = null) {
  await gitlabFrame(I, frameName, gitlabUrl.branches(global.journeyProjectName), { waitText, prepare })
}

async function assertBranchesExactly (expected) {
  const headers = await getRootHeaders()
  const names = ((await listProjectBranches(global.journeyProjectName, headers)).data || []).map(b => b.name).sort()
  if (JSON.stringify(names) !== JSON.stringify([...expected].sort())) {
    throw new Error(`Expected GitLab to hold exactly the branches ${JSON.stringify(expected)}, found ${JSON.stringify(names)}`)
  }
}

async function assertMainOn (title) {
  const found = await branchCommitTitle('main')
  if (found !== title) throw new Error(`Expected the main branch on GitLab to stay on "${title}", found "${found}"`)
}

// The commits of the open merge request, by title. GitLab fills them in once
// it has computed the merge request's diff, a moment after `glab mr create`.
async function mrCommitTitles () {
  const headers = await getRootHeaders()
  const url = `${BASE_URL}/api/v4/projects/${encodeURIComponent(projectPath(global.journeyProjectName))}` +
    `/merge_requests/${global.journeyMergeRequestIid}/commits`
  for (let i = 0; i < 30; i++) {
    const titles = ((await freshGet(url, headers)).data || []).map(c => c.title)
    if (titles.length) return titles
    await I.wait(2)
  }
  return []
}

storyboardStep(Given, 'GitLab holds a project whose main branch already has a first commit', async () => {
  await ensureLambdaUser()
  await stageJourney({ initialize_with_readme: true })
  await branchesCard('branches-before', 'Initial commit')
  await assertBranchesExactly(['main'])
  await assertMainOn('Initial commit')
})

// The experiment is typed on camera: the commit codes change every run.
storyboardStep(Given, "the developer's copy is on a local experiment branch with a commit of its own", async () => {
  await openTerminal(I, global.journeyContainer, STORY_TERMINAL)
  const screen = await terminalCard(I, 'terminal-experiment-branch', EXPERIMENT_LINE, {
    mask: [[/\b[0-9a-f]{7,40}\b/g, '<sha>']]
  })
  if (!screen.includes(`(HEAD -> ${EXPERIMENT_BRANCH}) ${EXPERIMENT_COMMIT}`) || !/\(.*origin\/main.*\) Initial commit/.test(screen)) {
    throw new Error(`Expected the history to show the experiment on ${EXPERIMENT_BRANCH} above "Initial commit" on main:\n${screen}`)
  }
  const branch = inProject('git branch --show-current').trim()
  if (branch !== EXPERIMENT_BRANCH) throw new Error(`Expected the clone on ${EXPERIMENT_BRANCH}, it is on "${branch}"`)
  const ahead = inProject(`git log --format=%s main..${EXPERIMENT_BRANCH}`).trim()
  if (ahead !== EXPERIMENT_COMMIT) throw new Error(`Expected ${EXPERIMENT_BRANCH} one commit ahead of main, "${EXPERIMENT_COMMIT}", found:\n${ahead}`)
})

// The whole run, every default accepted; the card is its end, from the line
// where the installer starts its delivery down to the prompt that came back.
storyboardStep(When, 'the developer runs the installer on the experiment branch, and it builds the framework branch from the main branch', async () => {
  await launchWorkingBranchInstaller(SCOPE_PROMPT, STORY_TERMINAL)
  await answerAndCompleteInstaller()
  await waitForPromptReturn(I, `bash ${WRAPPER_PATH}`, 60000)
  const preparing = `Preparing ${INIT_BRANCH} from main`
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-installer-opens-mr', {
    fromMarker: preparing,
    mask: [[new RegExp(global.journeyProjectName, 'g'), 'project']]
  }))
  assertInstallLog(preparing, `Opened merge request ${INIT_BRANCH} → main.`, 'Installation complete!')
})

storyboardStep(Then, 'GitLab holds a merge request into the main branch that carries only the framework commit', async () => {
  await findOpenMr(INIT_BRANCH, 'main')
  const titles = await mrCommitTitles()
  if (JSON.stringify(titles) !== JSON.stringify([INIT_COMMIT])) {
    throw new Error(`Expected merge request !${global.journeyMergeRequestIid} to carry only "${INIT_COMMIT}", it carries ${JSON.stringify(titles)}`)
  }
  await gitlabFrame(I, 'mr-commits', gitlabUrl.mr(global.journeyProjectName, global.journeyMergeRequestIid, 'commits'), {
    prepare: () => I.waitForElement('li.commit', 30),
    // The day header is a date, the SHA box an empty frame once its SHA is
    // blanked; the Pipelines and Changes counters move with every run and
    // every new framework file. The Commits counter stays: it is the proof.
    hide: ['li.js-commit-header', 'li.commit .commit-actions', '.pipelines-tab .gl-badge', '.diffs-tab .gl-badge']
  })
})

storyboardStep(Then, 'GitLab lists the main branch and the framework branch, never the experiment branch', async () => {
  // The ahead/behind counts arrive after the page, from their own request.
  await branchesCard('branches-after', INIT_BRANCH, () => I.waitForElement('.divergence-graph', 30))
  await assertBranchesExactly([INIT_BRANCH, 'main'])
  await assertMainOn('Initial commit')
  const local = inProject(`git log --format=%s main..${EXPERIMENT_BRANCH}`).trim()
  if (local !== EXPERIMENT_COMMIT) throw new Error(`Expected the experiment still on the developer's machine, ${EXPERIMENT_BRANCH} holds:\n${local}`)
})

// Chapter 1 is released first: its container, project and token never leak.
// The opt-out is typed on camera; the run then goes on off card, every default
// accepted. Its twin reads the installer's own words: go-task reports the
// merge-request step "up to date" (skipped on purpose, not crashed), and the
// branch is never prepared.
storyboardStep(When, 'another developer starts the installer on a new project with the review switched off', async () => {
  await releaseJourney()
  await stageJourney({})
  await launchWorkingBranchInstaller(SCOPE_PROMPT, { ...STORY_TERMINAL, line: DIRECT_LINE })
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-launch-direct', { fromMarker: `${DIRECT_SWITCH} bash` }))
  await answerAndCompleteInstaller()
  assertInstallLog('Task "glab:init-merge-request" is up to date', 'Installation complete!')
  if (readInstallLog().includes(`Preparing ${INIT_BRANCH}`)) {
    throw new Error(`Expected no ${INIT_BRANCH} branch to be prepared with ${DIRECT_SWITCH}`)
  }
})

storyboardStep(Then, 'GitLab shows the main branch alone, with no review branch and no merge request', async () => {
  await branchesCard('branches-direct', 'chore: initialize repository')
  await assertBranchesExactly(['main'])
  await assertMainOn('chore: initialize repository')
  await assertNoOpenMr()
})

// The README body renders after the page; the twins: the remote tree, and the
// framework really installed, waiting uncommitted in the clone.
storyboardStep(Then, 'the main branch on GitLab holds only the starter README', async () => {
  await gitlabFrame(I, 'gitlab-main-readme', gitlabUrl.tree(global.journeyProjectName), {
    waitText: 'chore: initialize repository',
    prepare: () => I.waitForText('my-project', 30)
  })
  await assertRootTreeExactly('main', ['README.md'])
  const status = inProject('git status --porcelain')
  if (!status.includes('?? Taskfile.yml')) {
    throw new Error(`Expected the framework installed and left uncommitted in the clone, git status says:\n${status}`)
  }
})

// ============================================
// Installer questionnaire storyboard — @install-complete (chapter 1).
// The full Copier walkthrough: one card per question, re-capturing the exact
// anchored moments the retired copier-*-terminal baselines proved (each gum/
// copier prompt erases itself on answer, so it is captured live). The Given
// closes the off-camera stage (lambda user, blank clone, staged installer,
// pre-installed toolchain, glab auth) with the blank working tree; the Then
// twins the completion screen and the scaffolded tree with install-log and ls
// asserts. Same underlying run as init-framework-mr, framed on the terminal
// journey instead of the GitLab pages.
// ============================================

// Advance to THIS Copier question, wait for its prompt, and capture it as a
// card. `advanceKey` accepts the PREVIOUS answer: 'y' keeps the complete
// framework (the gum scope confirm, ahead of the first question), 'Enter'
// keeps each subsequent default. The frame is anchored on the prompt so the
// copier scrollback above it is excluded.
// NO I.click here: copier's prompt (prompt_toolkit) enables mouse tracking, so
// clicking .xterm-screen is swallowed as a mouse report instead of focusing the
// terminal — the following Enter then never reaches copier and it hangs on the
// question. Focus persists from the launch card's click through every capture
// (a capture is DOM-only and never blurs the xterm textarea), so pressKey alone
// drives the questionnaire — the same key-only pattern answerAndCompleteInstaller
// and the agent-mode gum menus use after a frame.
async function captureCopierQuestion (advanceKey, prompt, frameName) {
  I.pressKey(advanceKey)
  await waitForTerminalText(I, prompt, COMMAND_TIMEOUT_MS)
  await waitForTerminalSettle(I)
  // No context rows above the anchor: the scrollback there (previous answer,
  // Copier chatter) wraps into a DIFFERENT row count per environment — one
  // extra line in CI broke tolerance:0 — so the card starts at the question.
  await addStoryboardFrame(I, await captureTerminalFrame(I, frameName, { fromMarker: prompt }))
}

storyboardStep(Given, 'a brand-new empty project waits on GitLab', async () => {
  await ensureLambdaUser()
  await openBlankProjectTerminal()
  prepareWorkingBranchInstaller(global.journeyContainer)
  preinstallToolchain(global.journeyContainer)
  authenticateGlab(global.journeyContainer, global.journeyLambdaToken)
  // Open on the empty project exactly as agent-mode does: the GitLab page of a
  // brand-new repository with nothing pushed.
  await pageFrame(async () => {
    await I.amOnPage(`/${projectPath(global.journeyProjectName)}`)
    await GitLabRepositoryPage.maskVolatile(global.journeyProjectName)
  }, 'gitlab-empty-project')
})

storyboardStep(Given, 'the developer has just cloned it into the terminal', async () => {
  // The GitLab navigation left the ttyd page — return to it (the shell session
  // is still alive, xterm reconnects) before driving the terminal.
  I.amOnPage(`http://${global.journeyContainer}:${ttydPort()}`) // DevSkim: ignore DS162092,DS137138 -- Ephemeral test terminal on the local Compose network.
  I.waitForElement('.xterm-screen', 10)
  I.wait(3)
  await typeCommandAndWait(I, 'clear')
  await typeCommandAndWait(I, 'git status')
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-blank-clone', { fromMarker: 'git status' }))
})

storyboardStep(When, 'the developer starts the toolbox installer', async () => {
  await launchWorkingBranchInstaller()
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-installer-launch', { fromMarker: `bash ${WRAPPER_PATH}` }))
})

storyboardStep(When, 'the developer keeps the complete framework and the first question asks about Ansible', () => captureCopierQuestion('y', 'Do you need Ansible?', 'copier-ansible'))

storyboardStep(When, 'the developer keeps GitLab as the CI/CD platform', () => captureCopierQuestion('Enter', 'Which CI/CD platform are you using?', 'copier-ci-platform'))

storyboardStep(When, 'the developer keeps the existing medium runner tag for Docker jobs', () => captureCopierQuestion('Enter', 'Runner tags for jobs that need Docker', 'copier-docker-runner-tags'))

storyboardStep(When, 'the developer keeps Docker as the container runtime', () => captureCopierQuestion('Enter', 'Which container runtime would you like to use?', 'copier-runtime'))

storyboardStep(When, 'the developer keeps the generated docker-compose file', () => captureCopierQuestion('Enter', 'Generate a docker-compose.yml file', 'copier-compose'))

storyboardStep(When, 'the developer confirms the runners can start privileged containers', () => captureCopierQuestion('Enter', 'Can your CI runners start privileged containers', 'copier-privileged-runners'))

storyboardStep(When, 'the developer keeps the project workspace enabled', () => captureCopierQuestion('Enter', 'Enable the project workspace?', 'copier-workspace'))

storyboardStep(When, 'the developer leaves source publication switched off', () => captureCopierQuestion('Enter', "Publish this project's source", 'copier-publication'))
storyboardStep(When, 'the developer keeps Renovate auto-merge enabled', () => captureCopierQuestion('Enter', 'Auto-merge Renovate merge requests', 'copier-automerge'))

storyboardStep(When, 'the developer keeps English as the Gherkin language', () => captureCopierQuestion('Enter', 'Language for Gherkin test specifications', 'copier-gherkin'))

storyboardStep(Then, 'the installer builds the project and shows the finished screen', async () => {
  // No click (see captureCopierQuestion): copier is still on the last question
  // with mouse tracking on; pressing Enter on the focused terminal accepts it.
  I.pressKey('Enter')
  await waitForInstallerComplete()
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-installer-complete', { fromMarker: 'Installation complete!' }))
  assertInstallLog(
    'Scaffolding project with Copier',
    'Your DevSecOps project has been created successfully!',
    'scaffolded successfully',
    'Installation complete!'
  )
  assertCreatedFilesAtLeast(200)
})

storyboardStep(Then, 'the project folder now holds the full DevSecOps framework', async () => {
  await typeCommandAndWait(I, 'clear')
  await typeCommandAndWait(I, 'ls -A1p --color=never')
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-project-tree', { fromMarker: 'ls -A1p --color=never' }))
  const res = execInContainerAsUser(global.journeyContainer, 'bootstrap', `cd ${PROJECT_DIR} && ls -A1`)
  const entries = stripAnsiEscapeSequences(res.output || '').split('\n').map(line => line.trim()).filter(Boolean)
  for (const file of ['Taskfile.yml', '.config', '.gitlab-ci.yml', '.agent']) {
    if (!entries.includes(file)) {
      throw new Error(`Expected the scaffolded working tree to contain "${file}". Entries: ${JSON.stringify(entries)}`)
    }
  }
})

// ============================================
// Fresh-machine storyboard — @fresh-machine.
// ONE bare machine, ONE terminal session, ONE arc: the installer refuses
// without curl; once curl is installed as it said, the README one-liner
// (curl from GitLab, piped into bash) asks before each tool it adds, the setup
// adds unzip with sudo by itself, and the run stops on the missing GitLab
// remote; following that advice opens the framework merge request on GitLab.
// Each stop's advice is proven by the next card. A last chapter runs the same
// installer with no terminal at all, as a CI job does. The terminal is 1440 px wide
// (159 columns, so the typed lines never wrap) and 900 px tall: about 52 rows,
// which keeps the first of the two "Configuring GitLab project..." lines (one
// per init attempt, some 70 rows apart) off the final card. Every card is
// twinned with the session log, the machine itself or the GitLab API.
// ============================================

// The installer served by the test GitLab the way gitlab.com serves it to the
// README one-liner: a public project of the lambda user, kept between runs.
const TOOLBOX_PROJECT = 'the-devsecops-toolbox'
const INSTALLER_FILE = '.config/devsecops/install.sh'
const NO_CURL = 'type curl git unzip; bash /tmp/install.sh; echo "exit code: $?"'
const INSTALL_CURL = 'sudo apt-get update -qq && sudo apt-get install -y -qq curl >/dev/null'
const NO_REMOTE_MARKER = "No 'origin' remote configured. Add a GitLab remote, then re-run."
const GIT_PROMPT = 'Install Git now? [Y/n]:'
const ON_PATH = 'export PATH="$HOME/.local/bin:$PATH"; '
// Known once the installer is on GitLab: the URL the one-liner fetches.
let installerUrl = null

// Put the working-branch installer where the one-liner fetches it. Create the
// project on the first run ever; "has already been taken" means it is there.
async function serveInstallerFromGitLab () {
  const headers = { 'PRIVATE-TOKEN': global.journeyLambdaToken }
  const created = await createProject(
    { name: TOOLBOX_PROJECT, visibility: 'public', initialize_with_readme: false, auto_devops_enabled: false },
    headers
  )
  if (created.status >= 400 && !JSON.stringify(created.data).includes('has already been taken')) {
    throw new Error(`Failed to create ${TOOLBOX_PROJECT} (status ${created.status}): ${JSON.stringify(created.data)}`)
  }
  const installer = fs.readFileSync(path.join(CONTAINER_WORKDIR, INSTALLER_FILE), 'utf8')
  await putRepositoryFile(TOOLBOX_PROJECT, INSTALLER_FILE, installer, headers, { message: 'chore: publish the installer' })
  return `http://gitlab/${projectPath(TOOLBOX_PROJECT)}/-/raw/main/${INSTALLER_FILE}` // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
}

function onMachine (script) {
  return execInContainerAsUser(global.journeyContainer, 'bootstrap', ON_PATH + script)
}

function assertLogSays (log, lines) {
  for (const line of lines) {
    if (!log.includes(line)) throw new Error(`Expected the session to show "${line}" (tail):\n${log.slice(-2000)}`)
  }
}

// A card from the scrollback: page the terminal up until `from` is rendered,
// bring it `before` rows below the top, and keep the rows down to `to`. The
// block is the run's own output that scrolled away while it kept going.
// ponytail: local copy of the end of captureTerminalFrame (which always
// scrolls to the bottom first); belongs in capture.js as a scrollback option.
async function scrollbackFrame (frameName, { from, before = 0, to, mask = [], noise = TERMINAL_NOISE_PATTERNS }) {
  await waitForTerminalSettle(I)
  const placed = await I.executeScript(async ([from, to, before]) => {
    const viewport = document.querySelector('.xterm-viewport')
    const rows = () => Array.from(document.querySelectorAll('.xterm-rows > div')).map(row => row.textContent || '')
    const redraw = () => new Promise(resolve => setTimeout(() => requestAnimationFrame(() => resolve()), 150))
    const nodes = document.querySelectorAll('.xterm-rows > div')
    const rowPx = nodes[1].getBoundingClientRect().top - nodes[0].getBoundingClientRect().top
    for (let top = viewport.scrollHeight - viewport.clientHeight; top > -viewport.clientHeight; top -= viewport.clientHeight / 2) {
      viewport.scrollTop = Math.max(0, top)
      await redraw()
      const at = rows().findIndex(text => text.includes(from))
      if (at === -1) continue
      viewport.scrollTop += (at - before) * rowPx
      await redraw()
      const shown = rows()
      const start = shown.findIndex(text => text.includes(from))
      return { start, end: shown.findIndex((text, i) => i > start && text.includes(to)) }
    }
    return { start: -1, end: -1 }
  }, [from, to, before])
  if (placed.start < before || placed.end === -1) {
    throw new Error(`Scrollback card "${frameName}": "${from}" and "${to}" are not on one screen (${JSON.stringify(placed)})`)
  }
  const info = await buildCompactTerminalCapture(
    I, COMPACT_CAPTURE_ID, noise.map(re => re.source),
    from, placed.end - placed.start + before + 1, before, mask
  )
  if (!info || !info.kept) throw new Error(`Scrollback card "${frameName}" produced no rows`)
  fs.mkdirSync(path.dirname(frameOutputPath(frameName)), { recursive: true })
  await I.captureScreenshot(`storyboard-frames/${frameName}`, 'actual', '#' + COMPACT_CAPTURE_ID)
  await removeCompactTerminalCapture(I, COMPACT_CAPTURE_ID)
  await scrollTerminalToBottom(I)
  await addStoryboardFrame(I, frameOutputPath(frameName))
}

// Off camera: the per-run GitLab project (empty, for the last chapter), the
// installer published on GitLab, and the bare machine with its terminal. On
// camera: one typed line that shows curl, git and unzip missing, runs the
// installer and prints its exit code.
storyboardStep(When, 'the developer runs the installer on a fresh machine without curl, it stops at its first check and says to install curl first', async () => {
  await createJourneyProject(setupBareMachineTerminal)
  installerUrl = await serveInstallerFromGitLab()
  await openTerminal(I, global.journeyContainer, { height: 900, width: 1440 })
  const screen = await terminalCard(I, 'refusal', NO_CURL)
  assertLogSays(screen, [
    'curl: not found', 'git: not found', 'unzip: not found',
    'curl is required but not installed.',
    'Install curl with your package manager, then rerun this installer.',
    'exit code: 1'
  ])
  if (screen.includes('Installing toolchain')) throw new Error(`Expected the installer to stop before its toolchain step:\n${screen}`)
})

// The advice followed on camera, then the README one-liner. The card stops on
// the first question, asked through the terminal while bash reads the pipe.
storyboardStep(When, 'the developer installs curl and pipes the installer from GitLab into bash, the installer asks before installing Git', async () => {
  await clearTerminal(I)
  await typeCommandAndWait(I, INSTALL_CURL)
  I.type(`curl -fsSL ${installerUrl} | bash`)
  I.pressKey('Enter')
  await waitForTerminalText(I, GIT_PROMPT, COMMAND_TIMEOUT_MS)
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'one-liner', { fromMarker: INSTALL_CURL }))
  const screen = await terminalScreenText(I)
  assertLogSays(screen, ['DevSecOps Toolbox Installer', 'Git is required to scaffold this project with Copier.'])
  if (onMachine('command -v curl').exitCode !== 0) throw new Error('Expected curl to be installed on the machine')
  if (onMachine('command -v git').exitCode === 0) throw new Error('Expected git to be still missing while the installer asks for it')
})

// Enter accepts each default, which is yes. The card starts at the last
// plain-shell question (the task and uv installs above it print temp paths and
// GitHub lookups that change every run) and catches the scope menu live:
// gum erases it once answered.
storyboardStep(When, 'the installer asks before adding gum and glow, then asks what to install, all through the pipe', async () => {
  I.pressKey('Enter')
  for (const question of ['Install task?', 'Install uv?', TOOLCHAIN_PROMPT]) {
    await waitForTerminalText(I, question, COMMAND_TIMEOUT_MS)
    I.pressKey('Enter')
  }
  await waitForTerminalText(I, SCOPE_PROMPT, COMMAND_TIMEOUT_MS)
  await waitForTerminalSettle(I)
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'gum-and-glow', {
    fromMarker: TOOLCHAIN_PROMPT,
    // gum and glow are pinned in install.sh and bumped by Renovate.
    mask: [[/v\d+\.\d+\.\d+/g, 'v<version>']]
  }))
  const screen = await terminalScreenText(I)
  if (!screen.includes('• Complete framework') || screen.includes('**')) {
    throw new Error(`Expected the scope card rendered by glow, not its markdown source:\n${screen}`)
  }
  assertLogSays(readInstallLog(), ['Install task? the task runner', 'Install uv? it installs copier'])
  const tools = onMachine('command -v git task uv gum glow')
  if (tools.exitCode !== 0) throw new Error(`Expected git, task, uv, gum and glow on the machine:\n${tools.output}`)
})

// 'y' keeps the complete framework, Enter keeps every Copier default, and the
// run goes on alone until the installer gives the prompt back. The unzip
// install scrolled by long before that, so the card pages back to it.
storyboardStep(Then, 'the setup finds unzip missing and installs it with sudo by itself', async () => {
  I.pressKey('y')
  for (const prompt of COPIER_PROMPTS) {
    await waitForTerminalText(I, prompt, COMMAND_TIMEOUT_MS)
    I.pressKey('Enter')
  }
  await waitForPromptReturn(I, 'the piped installer', COMMAND_TIMEOUT_MS)
  await scrollbackFrame('unzip-installed', {
    // Printed once; the "unzip is required" advice above it is also echoed by
    // go-task in its script dump, so it cannot be the anchor.
    from: 'task: Failed to run task "unzip:check:installed"',
    before: 8,
    to: 'unzip installed successfully!',
    // apt's "The following NEW packages will be installed:" is the header of
    // the "unzip" line under it: dropped as noise, it left unzip reading as
    // one of the "Suggested packages".
    noise: TERMINAL_NOISE_PATTERNS.filter(re => re.source !== '^The following NEW packages')
  })
  assertLogSays(readInstallLog(), ['❌ unzip is required before task devsecops:init.', 'Installing unzip with sudo...', 'unzip installed successfully!'])
  if (onMachine('command -v unzip').exitCode !== 0) throw new Error('Expected unzip to be installed on the machine')
})

// The last screen, from the step that stopped, plus its exit code: $? is
// still the piped bash's status, since the scrollback card typed nothing. The
// twins: the stop is in the log, and the Copier answers sent through the pipe
// did build the project.
storyboardStep(Then, 'the installer stops and says the project needs a GitLab remote', async () => {
  await typeCommandAndWait(I, 'echo "exit code: $?"')
  const screen = await terminalScreenText(I)
  if (screen.split('Configuring GitLab project...').length !== 2) {
    throw new Error(`Expected exactly one "Configuring GitLab project..." on the last screen:\n${screen}`)
  }
  if (!/exit code: [1-9]/.test(screen)) throw new Error(`Expected the installer to exit non-zero:\n${screen}`)
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'no-remote', { fromMarker: 'Configuring GitLab project...' }))
  const log = readInstallLog()
  assertLogSays(log, [NO_REMOTE_MARKER, 'task devsecops:init failed. Attempting to install missing prerequisites...'])
  const files = linesOf(inProject('ls -A1'))
  for (const file of ['.config', '.gitlab-ci.yml', 'Taskfile.yml']) {
    if (!files.includes(file)) throw new Error(`Expected the project folder to hold "${file}": ${JSON.stringify(files)}`)
  }
  if (files.includes('.git')) throw new Error('Expected the folder not to be a git repository yet')
})

// Off camera: the git identity, a credential store for the push and the glab
// sign-in. The developer then types the advice in the same terminal (its long
// setup output is not a card) and the proof is GitLab's own merge request page.
storyboardStep(Then, 'once the developer links the folder to a GitLab project and runs the setup again, GitLab shows the framework merge request into the main branch', async () => {
  const user = process.env.TASK_GITLAB_LAMBDA_USER
  const identity = onMachine([
    'git config --global user.email "lambda@test.local"',
    'git config --global user.name "Lambda"',
    'git config --global init.defaultBranch main',
    'git config --global credential.helper store',
    `printf 'http://%s:%s@gitlab\\n' ${shellEscape(user)} ${shellEscape(global.journeyLambdaToken)} > "$HOME/.git-credentials"`,
    'chmod 600 "$HOME/.git-credentials"'
  ].join(' && '))
  if (identity.exitCode !== 0) throw new Error(`Failed to set the git identity:\n${identity.output}`)
  authenticateGlab(global.journeyContainer, global.journeyLambdaToken)
  await typeCommandAndWait(I, `git init -q && git remote add origin http://gitlab/${projectPath(global.journeyProjectName)}.git && task devsecops:init`) // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
  assertLogSays(readInstallLog(), ['Opened merge request'])
  const mr = await findOpenMr('init-framework-devsecops', 'main')
  await assertBranchExists('main')
  await assertBranchExists('init-framework-devsecops')
  await assertMrChangedFiles()
  await inNewTab(I, () => gitlabFrame(I, 'framework-merge-request', gitlabUrl.mr(global.journeyProjectName, mr.iid), {
    waitText: 'init-framework-devsecops',
    // The merge box and the tab counters follow the pipelines GitLab starts
    // on its own.
    hide: ['.mr-state-widget', '.merge-request-tabs-container .gl-badge']
  }))
})

// The same installer with no terminal at all, as a CI job runs it: setsid
// leaves it no terminal to open and </dev/null nothing to read, so it may ask
// nothing. TASK_GLAB_ENABLED=false (the README's offline switch) skips the
// GitLab part: this folder belongs to no GitLab project. Off camera, gum and
// glow are taken off again, so the run has a tool to add without asking.
const CI_RUN = 'TASK_GLAB_ENABLED=false setsid -w bash /tmp/install.sh </dev/null >/tmp/ci.log 2>&1; echo "exit code: $?"; tail -n 3 /tmp/ci.log'
storyboardStep(Then, 'on a machine with no terminal at all, as in a CI job, the same installer asks nothing and installs the complete framework', async () => {
  const removed = onMachine('rm "$HOME/.local/bin/gum" "$HOME/.local/bin/glow"')
  if (removed.exitCode !== 0) throw new Error(`Failed to take gum and glow off the machine:\n${removed.output}`)
  await typeCommandAndWait(I, 'mkdir ~/ci && cd ~/ci')
  const screen = await terminalCard(I, 'no-terminal', CI_RUN)
  const log = stripAnsiEscapeSequences(onMachine('cat /tmp/ci.log').output || '')
  assertLogSays(screen, ['exit code: 0', 'Installation complete!'])
  assertLogSays(log, ['Installing gum v', 'Installing glow v', 'Project scaffolded successfully.'])
  for (const question of ['Install gum and glow?', 'Install the complete DevSecOps framework?']) {
    if (log.includes(question)) throw new Error(`Expected no question without a terminal, got "${question}":\n${log.slice(-2000)}`)
  }
  const files = linesOf(stripAnsiEscapeSequences(onMachine('ls -A1 "$HOME/ci"').output || ''))
  for (const file of ['.agent', '.gitlab-ci.yml', 'Taskfile.yml']) {
    if (!files.includes(file)) throw new Error(`Expected the complete framework in ~/ci, missing "${file}": ${JSON.stringify(files)}`)
  }
  if (onMachine('command -v gum glow').exitCode !== 0) throw new Error('Expected gum and glow back on the machine')
})
