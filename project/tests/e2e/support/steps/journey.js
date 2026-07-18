/* global inject Before After Given When Then */
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
  readProjectVariable
} = require('../helpers/gitlabApi')
const { freshGet } = require('../helpers/http')
const {
  PROJECT_DIR,
  INSTALL_LOG,
  WRAPPER_PATH,
  setupClonedProjectTerminal,
  setupCspellUpdateTerminal,
  prepareWorkingBranchInstaller,
  preinstallToolchain,
  authenticateGlab,
  teardownJourneyTerminal
} = require('../helpers/journeyContainer')
const {
  typeCommandAndWait,
  waitForTerminalText,
  waitForTerminalSettle,
  assertTerminalVisualMatch,
  captureTerminalFrame,
  COMMAND_TIMEOUT_MS
} = require('../terminal/capture')
// The storyboard API ships with the template (.config/codeceptjs/) so
// generated projects use the exact same step-side helpers.
const {
  storyboardStep,
  addStoryboardFrame,
  capturePageFrame,
  captureElementFrame
} = require('../../../../../.config/codeceptjs/storyboard')

const E2E_OUTPUT = path.resolve(__dirname, '..', '..', '_output')

Before(() => {
  global.journeyContainer = null
  global.journeyProjectName = null
  global.journeyLambdaToken = null
  global.journeyLambdaTokenId = null
  global.journeyMergeRequestIid = null
})

After(async () => {
  // Save the full installer log as a debug artifact (best-effort) so a failing
  // run can be diagnosed from the complete output, alongside the visual diffs.
  // The file is named after the per-scenario project so parallel workers (and
  // mocha retries) never overwrite the log of the scenario that failed.
  if (global.journeyContainer) {
    try {
      const logName = `install-${global.journeyProjectName || global.journeyContainer}.log`
      const dest = path.join(E2E_OUTPUT, 'install-logs', logName)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      runCommand(`docker cp ${shellEscape(`${global.journeyContainer}:${INSTALL_LOG}`)} ${shellEscape(dest)}`)
    } catch (_) {
      // No installer log for this scenario (e.g. blank-repo only) — ignore.
    }
  }

  teardownJourneyTerminal(global.journeyContainer)
  global.journeyContainer = null

  if (global.journeyProjectName) {
    try {
      const rootHeaders = await getRootHeaders()
      await deleteProject(global.journeyProjectName, rootHeaders)
    } catch (_) {
      // Best-effort cleanup — GitLab deletion is async and non-critical.
    }
    global.journeyProjectName = null
  }

  // Revoke the per-scenario lambda PAT so credentials do not accumulate on
  // the persistent test-GitLab volume across runs.
  if (global.journeyLambdaTokenId) {
    try {
      const rootHeaders = await getRootHeaders()
      await revokePersonalAccessToken(global.journeyLambdaTokenId, rootHeaders)
    } catch (_) {
      // Best-effort cleanup.
    }
    global.journeyLambdaTokenId = null
  }
})

// ============================================
// GIVEN — environment setup
// ============================================

async function openBlankProjectTerminal () {
  const rootHeaders = await getRootHeaders()
  const projectName = `e2e-journey-${crypto.randomBytes(4).toString('hex')}`
  global.journeyProjectName = projectName

  // Create a truly empty project (no README) under the lambda namespace so the
  // cloned working tree is genuinely blank ("No commits yet").
  const { token: lambdaToken, id: lambdaTokenId } = await createLambdaPersonalAccessToken(
    `journey-${projectName}`,
    ['api', 'write_repository'],
    rootHeaders
  )
  global.journeyLambdaToken = lambdaToken
  global.journeyLambdaTokenId = lambdaTokenId
  const created = await createProject(
    { name: projectName, visibility: 'public', initialize_with_readme: false },
    { 'PRIVATE-TOKEN': lambdaToken }
  )
  if (created.status >= 400) {
    throw new Error(`Failed to create blank project "${projectName}" (status ${created.status}): ${JSON.stringify(created.data)}`)
  }

  global.journeyContainer = setupClonedProjectTerminal(projectName, lambdaToken)
  I.amOnPage(`http://${global.journeyContainer}:${ttydPort()}`) // DevSkim: ignore DS162092
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

When('I display the project tree in the terminal', async () => {
  // Full depth (the rendered .agent/ tree bottoms out at skills/<name>/SKILL.md)
  // so every guardrail file is visible — rules/, workflows/ AND each skill's
  // SKILL.md — not just the skill folder names. Excludes the .git plumbing.
  await typeCommandAndWait(I, "clear; tree -a -I '.git'")
})

// ============================================
// Toolbox-update storyboard — @toolbox-update (chapter 1).
// The real Renovate-driven upgrade in a live, coloured ttyd terminal: a project
// generated from an EARLIER toolbox version (single-file config.json, the
// developer's word crammed in) runs the exact command Renovate triggers
// (`task copier:update`), which splits the dictionary and moves the developer's
// word into its own file. ONE sentence = ONE terminal frame = ONE pixel baseline
// (anchored on the typed command's `# comment` marker so scrollback is excluded);
// each AFTER card twins its frame with a filesystem read straight from the
// container, so a regression fails loud even without eyes.
// ============================================

const CSPELL_PROJECT_WORD = 'Caddyfile'
const OLD_TOOLBOX_VERSION = '22.0.0'
const NEW_TOOLBOX_VERSION = '22.7.1'

// Read a real path inside the live journey container's project — the
// programmatic twin of a terminal card (the same fact, unfiltered).
function readInProject (script) {
  const res = execInContainerAsUser(global.journeyContainer, 'bootstrap', `cd ${PROJECT_DIR} && ${script}`)
  if (res.exitCode !== 0) {
    throw new Error(`Toolbox-update twin failed (\`${script}\`):\n${res.output}`)
  }
  return res.output
}

function twinContains (script, needle) {
  const out = readInProject(script)
  if (!out.includes(needle)) {
    throw new Error(`Toolbox-update twin: expected "${needle}" in \`${script}\`:\n${out}`)
  }
}

function twinExcludes (script, needle) {
  const out = readInProject(script)
  if (out.includes(needle)) {
    throw new Error(`Toolbox-update twin: did NOT expect "${needle}" in \`${script}\`:\n${out}`)
  }
}

// Type a command in the live terminal and snapshot the moment as a storyboard
// frame, anchored on a unique substring of the command so the non-deterministic
// scrollback above it is excluded.
async function updateCard (command, marker, frameName, timeoutMs) {
  await typeCommandAndWait(I, command, timeoutMs || COMMAND_TIMEOUT_MS)
  await addStoryboardFrame(I, await captureTerminalFrame(I, frameName, { fromMarker: marker }))
}

storyboardStep(Given, "a developer's project was generated from an earlier toolbox release", async () => {
  global.journeyContainer = setupCspellUpdateTerminal(CSPELL_PROJECT_WORD)
  I.amOnPage(`http://${global.journeyContainer}:${ttydPort()}`) // DevSkim: ignore DS162092
  I.waitForElement('.xterm-screen', 10)
  I.wait(3)
  await updateCard(
    `grep _commit .config/devsecops/.copier-answers.yml   # toolbox version BEFORE (${OLD_TOOLBOX_VERSION})`,
    'toolbox version BEFORE', 'before-version'
  )
  twinContains('grep _commit .config/devsecops/.copier-answers.yml', OLD_TOOLBOX_VERSION)
})

storyboardStep(Given, 'its CI pipeline runs on that older toolbox image', async () => {
  await updateCard(
    `grep '^image:' .gitlab-ci.yml   # toolbox image BEFORE (${OLD_TOOLBOX_VERSION})`,
    'toolbox image BEFORE', 'before-ci-image'
  )
  twinContains('grep ^image: .gitlab-ci.yml', OLD_TOOLBOX_VERSION)
})

storyboardStep(Given, 'its spelling dictionary is a single framework-owned file', async () => {
  await updateCard('ls -1 .config/cspell/   # one framework-owned file', 'one framework-owned file', 'before-one-file')
  twinExcludes('ls -1 .config/cspell/', 'config.project.json')
})

storyboardStep(Given, 'the developer has added their own word inside that shared file', async () => {
  await updateCard(
    `jq '.words[-4:]' .config/cspell/config.json   # the developer word (${CSPELL_PROJECT_WORD}) crammed in among the framework's`,
    'crammed in among', 'before-word-inline'
  )
  twinContains('jq -r .words .config/cspell/config.json', CSPELL_PROJECT_WORD)
})

storyboardStep(When, 'the developer runs the toolbox update in the terminal', async () => {
  await updateCard(
    `task copier:update TASK_COPIER_CLI_OPTS='--skip-answered --defaults --quiet --vcs-ref ${NEW_TOOLBOX_VERSION}'`,
    'task copier:update', 'update-run', 240000
  )
})

storyboardStep(Then, 'the project now tracks the new toolbox release', async () => {
  await updateCard(
    `grep _commit .config/devsecops/.copier-answers.yml   # toolbox version AFTER (${NEW_TOOLBOX_VERSION})`,
    'toolbox version AFTER', 'after-version'
  )
  twinContains('grep _commit .config/devsecops/.copier-answers.yml', NEW_TOOLBOX_VERSION)
})

storyboardStep(Then, 'its CI pipeline now runs on the new toolbox image', async () => {
  await updateCard(
    `grep '^image:' .gitlab-ci.yml   # toolbox image AFTER (${NEW_TOOLBOX_VERSION})`,
    'toolbox image AFTER', 'after-ci-image'
  )
  twinContains('grep ^image: .gitlab-ci.yml', NEW_TOOLBOX_VERSION)
  twinExcludes('grep ^image: .gitlab-ci.yml', OLD_TOOLBOX_VERSION)
})

storyboardStep(Then, 'its dictionary has been split into three files', async () => {
  await updateCard('ls -1 .config/cspell/   # three files now', 'three files now', 'after-three-files')
  twinContains('ls -1 .config/cspell/', 'config.base.json')
  twinContains('ls -1 .config/cspell/', 'config.project.json')
})

storyboardStep(Then, 'the framework keeps its own words in its own file', async () => {
  await updateCard(
    "jq '.words[-4:]' .config/cspell/config.base.json   # the framework words: KEPT, in the framework's own file",
    'framework words: KEPT', 'after-framework-words'
  )
  twinExcludes('jq -r .words .config/cspell/config.base.json', CSPELL_PROJECT_WORD)
})

storyboardStep(Then, "the developer's own word has moved to a project-owned file", async () => {
  await updateCard(
    'jq . .config/cspell/config.project.json   # the developer word: MOVED to its own file',
    'MOVED to its own file', 'after-project-word'
  )
  twinContains('jq -r .words .config/cspell/config.project.json', CSPELL_PROJECT_WORD)
})

storyboardStep(Then, 'the shared file itself is now empty — it only imports the other two', async () => {
  await updateCard(
    "jq '.words' .config/cspell/config.json   # config.json: empty now, only imports the other two",
    'empty now, only imports', 'after-config-image'
  )
  twinExcludes('jq -r .words .config/cspell/config.json', CSPELL_PROJECT_WORD)
})

// The installer WHEN bindings (type command / launch / accept-default-and-wait
// per prompt / wait-for-completion) were removed with the storyboard migration:
// the questionnaire is now driven by the @install-complete storyboard
// steps below, which capture each Copier question as its own card. The poll for
// install.sh's completion marker lives in waitForInstallerComplete().

// ============================================
// THEN — proofs
// ============================================

// Marker-anchored capture: keeps only the rows from `marker` downward, so the
// non-deterministic install scrollback above an interactive prompt is excluded.
Then('the terminal from {string} should visually match {string}', async (marker, baselineName) => {
  await assertTerminalVisualMatch(I, baselineName, { fromMarker: marker })
})

// The milestone-block and install-log plain bindings (used only by the retired
// flat installer/piped scenarios) were removed with the storyboard migration;
// the storyboard steps below assert the install log through assertInstallLog()
// and assertCreatedFilesAtLeast() instead.

// ============================================
// Init-framework-devsecops MR flow (stage 4)
// ============================================

// The first decision the installer asks (gum/glow layer), before any Copier
// question. The full-framework journey accepts it (default affirmative).
const SCOPE_PROMPT = 'Install the complete DevSecOps framework?'
const AGENT_DONE_MARKER = 'Installed the AI agent context only'
// install.sh prints this when the scope resolves to "none" — the exact symptom
// of the multi-select trap (declined the framework, the lone item never toggled).
const NOTHING_MARKER = 'Nothing selected'

const COPIER_PROMPTS = [
  'Do you need Ansible?',
  'Which CI/CD platform are you using?',
  'Which container runtime would you like to use?',
  'Generate a docker-compose.yml file',
  'Enable the project workspace?',
  'Auto-merge Renovate merge requests',
  'Language for Gherkin test specifications'
]

async function openReadmeProjectTerminal () {
  const rootHeaders = await getRootHeaders()
  const projectName = `e2e-journey-${crypto.randomBytes(4).toString('hex')}`
  global.journeyProjectName = projectName
  const { token: lambdaToken, id: lambdaTokenId } = await createLambdaPersonalAccessToken(
    `journey-${projectName}`, ['api', 'write_repository'], rootHeaders
  )
  global.journeyLambdaToken = lambdaToken
  global.journeyLambdaTokenId = lambdaTokenId
  // initialize_with_readme:true -> the project already has a main branch + commit.
  const created = await createProject(
    { name: projectName, visibility: 'public', initialize_with_readme: true },
    { 'PRIVATE-TOKEN': lambdaToken }
  )
  if (created.status >= 400) {
    throw new Error(`Failed to create project "${projectName}" (status ${created.status}): ${JSON.stringify(created.data)}`)
  }
  global.journeyContainer = setupClonedProjectTerminal(projectName, lambdaToken)
  I.amOnPage(`http://${global.journeyContainer}:${ttydPort()}`) // DevSkim: ignore DS162092
  I.waitForElement('.xterm-screen', 10)
  I.wait(3)
}

// openReadmeProjectTerminal and the spike-branch checkout are now driven from
// the init-framework-MR storyboard Given steps (below); their former plain
// bindings were removed with the storyboard migration.

// Re-open the live terminal (a GitLab-page capture may have navigated away),
// type the installer command and stop at the FIRST decision (the gum/glow scope
// prompt). Split out so a storyboard step can frame the launch before answering.
async function launchWorkingBranchInstaller () {
  I.amOnPage(`http://${global.journeyContainer}:${ttydPort()}`) // DevSkim: ignore DS162092
  I.waitForElement('.xterm-screen', 10)
  I.wait(2)
  I.click('.xterm-screen')
  I.type(`bash ${WRAPPER_PATH}`)
  I.pressKey('Enter')
  await waitForTerminalText(I, SCOPE_PROMPT, COMMAND_TIMEOUT_MS)
  await waitForTerminalSettle(I)
}

// Poll install.sh's PERSISTENT log until it prints its final marker. NOT the
// glab sub-installer's "Installation complete!" (that appears earlier): this
// is install.sh's own last line, after scaffolding + `task devsecops:init`
// (dev-environment setup + GitLab config), so it proves the whole run finished.
async function waitForInstallerComplete (timeoutMs = 600000) {
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

async function runWorkingBranchInstaller () {
  await launchWorkingBranchInstaller()
  await answerAndCompleteInstaller()
}

// The "I run the working-branch installer to completion" and "I choose to
// install the complete framework" plain bindings were removed with the
// storyboard migration (their only feature callers — piped-install and the
// flat installer — are now storyboards). runWorkingBranchInstaller stays: the
// init-framework-mr storyboard steps still call it directly.

// ============================================
// Agent-mode storyboard — ONE sentence = ONE card = ONE pixel baseline.
// storyboardStep (shipped by .config/codeceptjs/storyboard.js) registers the
// step AND opens a card whose title IS the step's own Gherkin text: the same
// string declares the scenario line and captions the image, so the feature
// and the storyboard can never drift apart. EVERY sentence of the scenario
// goes through it — the Given closes the off-camera stage with its visual
// proof, each Then pairs its card with a programmatic assert of the same
// fact — and addStoryboardFrame asserts each frame against its own baseline
// INSIDE the step, so a visual regression fails on the exact sentence whose
// image drifted. The plugin renders the SVG when the test ends.
// ============================================

// The fresh project on GitLab, README only. Public project -> stable anonymous
// view; volatile content is masked. The shorter viewport keeps the panel
// focused on the file tree (the masked header is hidden).
// The WHOLE stage in one sentence, closed by its visual proof. Off-camera:
// the lambda user, the public README project, the ttyd terminal with the
// project cloned, the staged working-branch installer, the pre-installed
// toolchain (its volatile output must never reach a frame). On camera: the
// blank project page — a README and nothing else.
storyboardStep(Given, 'a fresh GitLab project with only a README on its main branch', async () => {
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
  await openReadmeProjectTerminal()
  prepareWorkingBranchInstaller(global.journeyContainer)
  preinstallToolchain(global.journeyContainer)
  I.resizeWindow(1024, 640)
  await I.amOnPage(`/${projectPath(global.journeyProjectName)}`)
  await GitLabRepositoryPage.maskVolatile(global.journeyProjectName)
  await addStoryboardFrame(I, await capturePageFrame(I, 'agent-mode-gitlab-before'))
  I.resizeWindow(1024, 768)
})

// Back to the live terminal — a NEW shell session (the GitLab capture navigated
// away); the cloned repo state lives on disk, not in the session.
storyboardStep(When, 'the developer opens the cloned project in the terminal', async () => {
  I.amOnPage(`http://${global.journeyContainer}:${ttydPort()}`) // DevSkim: ignore DS162092
  I.waitForElement('.xterm-screen', 10)
  I.wait(3)
  await typeCommandAndWait(I, 'clear')
  await typeCommandAndWait(I, 'ls -A1')
  await typeCommandAndWait(I, 'git status')
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-1-clone'))
})

// The frame is anchored on the TYPED COMMAND (the story must show what was
// executed), and ArrowRight moves the gum focus onto "Choose components"
// BEFORE the capture, so the image shows the choice the developer actually
// makes — not the default-highlighted "Install everything".
storyboardStep(When, 'the developer starts the installer and chooses to pick what to install', async () => {
  I.click('.xterm-screen')
  I.type(`bash ${WRAPPER_PATH}`)
  I.pressKey('Enter')
  await waitForTerminalText(I, SCOPE_PROMPT, COMMAND_TIMEOUT_MS)
  await waitForTerminalSettle(I)
  I.pressKey('ArrowRight')
  await waitForTerminalSettle(I)
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-2-choice', { fromMarker: `bash ${WRAPPER_PATH}` }))
})

// Submit the focused "Choose components" -> the live checklist, captured while
// it is on screen (it erases itself on answer), then take the highlighted
// component with the natural Enter.
storyboardStep(When, 'the developer picks the AI agent option from the checklist', async () => {
  I.pressKey('Enter')
  await waitForTerminalText(I, 'Select the component to install', COMMAND_TIMEOUT_MS)
  await waitForTerminalSettle(I)
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-3-checklist', { fromMarker: 'Select the component to install' }))
  I.pressKey('Enter')
})

// The install runs to its end marker (or the "Nothing selected" trap on a buggy
// build — the working-tree Then is the loud signal), then the local result:
// full-depth tree (no -L) because the guardrails bottom out at
// skills/<name>/SKILL.md and a shallower listing would hide those files.
storyboardStep(When, 'the installer installs only the AI agent files', async () => {
  const readLog = () => stripAnsiEscapeSequences(
    execInContainerAsUser(
      global.journeyContainer, 'bootstrap',
      `cat ${INSTALL_LOG} 2>/dev/null || true`
    ).output || ''
  )
  const deadline = Date.now() + 240000
  while (Date.now() < deadline) {
    const log = readLog()
    if (log.includes(AGENT_DONE_MARKER) || log.includes(NOTHING_MARKER)) break
    await I.wait(2)
  }
  await waitForTerminalSettle(I)
  // Two frames: the installer's own delivery lines first (the ~50-row tree
  // would scroll them out of the viewport before a single capture), then the
  // resulting working tree.
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-4-installed', { fromMarker: 'Installing agent mode' }))
})

// The card shows the full-depth tree (the guardrails bottom out at
// skills/<name>/SKILL.md); the programmatic twin asserts the same fact with
// an ls in the container — the installer ADDED only the AI agent context
// while leaving the repo's own README intact.
storyboardStep(Then, 'the project folder now holds only the AI agent files', async () => {
  await typeCommandAndWait(I, 'ls -A1')
  await typeCommandAndWait(I, "tree -a -I '.git'")
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-4b-delivered', { fromMarker: 'ls -A1' }))
  const res = execInContainerAsUser(
    global.journeyContainer, 'bootstrap',
    `cd ${PROJECT_DIR} && ls -A1 | grep -v '^.git$' | sort`
  )
  const entries = stripAnsiEscapeSequences(res.output || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .sort()
  const expected = ['.agent', 'AGENTS.md', 'CLAUDE.md', 'README.md'].sort()
  const matches = entries.length === expected.length &&
    expected.every((name, i) => entries[i] === name)
  if (!matches) {
    throw new Error(
      `Expected the working tree to contain exactly ${JSON.stringify(expected)} (plus .git), ` +
      `found ${JSON.stringify(entries)}`
    )
  }
})

// The GitLab hook: agent mode goes straight to main (no MR). Off-camera, point
// origin at a token-free URL backed by a credential store so the push never
// renders the PAT; on-camera, commit + push -q + list the REMOTE main.
storyboardStep(When, 'the developer pushes the AI agent files to main', async () => {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  execInContainerAsUser(global.journeyContainer, 'bootstrap', [
    `cd ${PROJECT_DIR}`,
    `git remote set-url origin http://gitlab/${lambdaUser}/${global.journeyProjectName}.git`,
    'git config --global credential.helper store',
    `printf 'http://%s:%s@gitlab\\n' ${shellEscape(lambdaUser)} ${shellEscape(global.journeyLambdaToken)} > "$HOME/.git-credentials"`,
    'chmod 600 "$HOME/.git-credentials"'
  ].join('\n'))
  await typeCommandAndWait(I, 'git add -A && git commit -q -m "chore: install the AI agent guardrails"')
  await typeCommandAndWait(I, 'git push -q origin main')
  await typeCommandAndWait(I, 'git ls-tree origin/main --name-only   # now on the remote main')
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-5-push', { fromMarker: 'git add -A' }))
})

// The same project page now carries the guardrails, then the .agent tree
// itself (the repo root alone would hide what agent mode actually shipped).
// The remote proof, visual AND programmatic: the project page carries the
// guardrails on main, and the REST tree of the branch confirms each file.
storyboardStep(Then, "the AI agent files are live on the project's main page", async () => {
  I.resizeWindow(1024, 640)
  await I.amOnPage(`/${projectPath(global.journeyProjectName)}`)
  await GitLabRepositoryPage.maskVolatile(global.journeyProjectName)
  await addStoryboardFrame(I, await capturePageFrame(I, 'agent-mode-gitlab-after'))
  I.resizeWindow(1024, 768)
  for (const file of ['.agent', 'AGENTS.md', 'CLAUDE.md']) {
    await assertBranchContainsFile('main', file)
  }
})

storyboardStep(Then, 'the .agent folder can now be opened on GitLab', async () => {
  I.resizeWindow(1024, 640)
  await I.amOnPage(`/${projectPath(global.journeyProjectName)}/-/tree/main/.agent`)
  await GitLabRepositoryPage.maskVolatile(global.journeyProjectName)
  await addStoryboardFrame(I, await capturePageFrame(I, 'agent-mode-gitlab-after-agent-tree'))
  I.resizeWindow(1024, 768)
  const headers = await getRootHeaders()
  const res = await listRepositoryTree(
    global.journeyProjectName,
    headers,
    '?ref=main&path=.agent&per_page=100'
  )
  const names = (res.data || []).map(entry => entry.name)
  for (const dir of ['rules', 'skills', 'workflows']) {
    if (!names.includes(dir)) {
      throw new Error(`Expected the remote .agent tree to contain "${dir}". Entries: ${JSON.stringify(names)}`)
    }
  }
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

// assertBranchContainsFile is consumed by the agent-mode storyboard (the shipped
// guardrails on the remote branch), so it stays even though the stage-5 plain
// binding that also used it was removed with the storyboard migration.
async function assertBranchContainsFile (branch, file) {
  const headers = await getRootHeaders()
  const res = await listRepositoryTree(
    global.journeyProjectName,
    headers,
    `?ref=${encodeURIComponent(branch)}&per_page=100`
  )
  const names = (res.data || []).map(entry => entry.name)
  if (!names.includes(file)) {
    throw new Error(`Expected branch "${branch}" tree to contain "${file}". Top-level entries: ${JSON.stringify(names)}`)
  }
}

// ============================================
// Init-framework-MR storyboard — ONE sentence = ONE card = ONE pixel baseline.
// Four scenarios, one per delivery case (blank / existing-main / other-branch /
// direct), each keying its own per-tag baseline folder. The Given closes the
// off-camera stage (lambda user, cloned terminal, staged installer, glab auth)
// with its visual proof; each Then pairs its page/terminal frame with a
// programmatic REST assert of the SAME fact, so a regression fails loud even
// without eyes. Reuses the same masked page captures as the flat scenarios.
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

function checkoutFeatureBranch (branch) {
  const res = execInContainerAsUser(global.journeyContainer, 'bootstrap', [
    `cd ${PROJECT_DIR}`,
    `git checkout -b ${shellEscape(branch)}`
  ].join('\n'))
  if (res.exitCode !== 0) {
    throw new Error(`Failed to checkout feature branch "${branch}":\n${res.output}`)
  }
}

// Capture a masked GitLab page as a storyboard frame at the storyboard's page
// aspect (1024x640), then restore the default window. `navigate` runs the
// page-object goto+mask; `frameName` is the per-scenario baseline stem.
async function pageFrame (navigate, frameName) {
  I.resizeWindow(1024, 640)
  await navigate()
  await addStoryboardFrame(I, await capturePageFrame(I, frameName))
  I.resizeWindow(1024, 768)
}

// The MR overview page is mostly a white sheet once the tabs/notes are masked;
// crop the frame to its header block (status + "requested to merge <source>
// into <target>") so the card is content, not white space.
async function mrHeaderFrame (frameName) {
  I.resizeWindow(1024, 640)
  await GitLabMergeRequestPage.gotoAndMaskCropHeader(
    projectPath(global.journeyProjectName),
    global.journeyMergeRequestIid,
    global.journeyProjectName
  )
  await addStoryboardFrame(I, await captureElementFrame(I, frameName, '#storyboard-mr-crop'))
  I.resizeWindow(1024, 768)
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
  await mrHeaderFrame('gitlab-merge-request')
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
    'gitlab-merge-settings'
  )
  await assertMergeMethodFf()
})

storyboardStep(Then, 'GitLab now refuses pushes straight to main', async () => {
  await pageFrame(
    () => GitLabSettingsPage.gotoProtectedBranchAndMask(projectPath(global.journeyProjectName), global.journeyProjectName),
    'gitlab-protected-branch'
  )
  await assertMainProtected('main')
})

storyboardStep(Then, 'GitLab now holds an automation token for the project', async () => {
  await pageFrame(
    () => GitLabAccessTokenPage.gotoAccessTokensAndMask(projectPath(global.journeyProjectName)),
    'gitlab-access-tokens'
  )
  await assertTokenMaintainer('TASK_COMMITIZEN_TOKEN')
})

storyboardStep(Then, 'GitLab now keeps that token as a CI/CD variable', async () => {
  await pageFrame(
    () => GitLabAccessTokenPage.gotoCiCdAndMask(projectPath(global.journeyProjectName)),
    'gitlab-cicd-variables'
  )
  await assertCommitizenVariable()
})

// --- Case B: main already exists --------------------------------------------

storyboardStep(Given, 'a developer has cloned a project that already has a main branch', async () => {
  await ensureLambdaUser()
  await openReadmeProjectTerminal()
  prepareWorkingBranchInstaller(global.journeyContainer)
  authenticateGlab(global.journeyContainer, global.journeyLambdaToken)
  await typeCommandAndWait(I, 'clear')
  await typeCommandAndWait(I, 'git branch -a')
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-existing-main', { fromMarker: 'git branch -a' }))
})

storyboardStep(When, 'the installer finishes setup on the project that already had main', async () => {
  await runWorkingBranchInstaller()
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-complete-existing-main', { fromMarker: 'Installation complete!' }))
  assertInstallLog('init-framework-devsecops', 'Installation complete!')
})

storyboardStep(Then, 'a merge request into the existing main is now open on GitLab', async () => {
  await findOpenMr('init-framework-devsecops', 'main')
  await mrHeaderFrame('mr-header-existing-main')
})

storyboardStep(Then, 'GitLab lists main next to the init-framework-devsecops branch', async () => {
  await pageFrame(async () => {
    await I.amOnPage(`/${projectPath(global.journeyProjectName)}/-/branches`)
    await GitLabRepositoryPage.maskVolatile(global.journeyProjectName)
  }, 'branches-existing-main')
  await assertBranchExists('main')
  await assertBranchExists('init-framework-devsecops')
})

// --- Case C: run from a spike branch ----------------------------------------

storyboardStep(Given, 'a developer is working on an experiment branch instead of main', async () => {
  await ensureLambdaUser()
  await openReadmeProjectTerminal()
  checkoutFeatureBranch('spike/poc')
  prepareWorkingBranchInstaller(global.journeyContainer)
  authenticateGlab(global.journeyContainer, global.journeyLambdaToken)
  await typeCommandAndWait(I, 'clear')
  await typeCommandAndWait(I, 'git branch')
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-spike-branch', { fromMarker: 'git branch' }))
})

storyboardStep(When, 'the installer finishes setup while on the experiment branch', async () => {
  await runWorkingBranchInstaller()
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-complete-spike', { fromMarker: 'Installation complete!' }))
  assertInstallLog('init-framework-devsecops', 'Installation complete!')
})

storyboardStep(Then, 'the new merge request targets main, not the experiment branch', async () => {
  await findOpenMr('init-framework-devsecops', 'main')
  await mrHeaderFrame('mr-header-spike')
})

storyboardStep(Then, 'GitLab shows only main and the framework branch, never the local experiment branch', async () => {
  await pageFrame(async () => {
    await I.amOnPage(`/${projectPath(global.journeyProjectName)}/-/branches`)
    await GitLabRepositoryPage.maskVolatile(global.journeyProjectName)
  }, 'branches-spike')
  await assertBranchExists('main')
  await assertBranchExists('init-framework-devsecops')
  await assertBranchAbsent('spike/poc')
})

// --- Case D: direct delivery (no merge request) -----------------------------

storyboardStep(Given, 'a developer has set the installer to deliver straight to main', async () => {
  await ensureLambdaUser()
  await openBlankProjectTerminal()
  prepareWorkingBranchInstaller(global.journeyContainer, { direct: true })
  authenticateGlab(global.journeyContainer, global.journeyLambdaToken)
  await typeCommandAndWait(I, 'clear')
  await typeCommandAndWait(I, 'git status')
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-blank-direct', { fromMarker: 'git status' }))
})

storyboardStep(When, 'the installer finishes setup in direct-delivery mode', async () => {
  await runWorkingBranchInstaller()
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-complete-direct', { fromMarker: 'Installation complete!' }))
  assertInstallLog('Installation complete!')
})

storyboardStep(Then, 'GitLab shows main alone, with no review branch and no merge request', async () => {
  await pageFrame(async () => {
    await I.amOnPage(`/${projectPath(global.journeyProjectName)}/-/branches`)
    await GitLabRepositoryPage.maskVolatile(global.journeyProjectName)
  }, 'branches-direct')
  await assertBranchExists('main')
  await assertBranchAbsent('init-framework-devsecops')
  await assertNoOpenMr()
})

storyboardStep(Then, "the project's main holds only the starter README", async () => {
  await pageFrame(async () => {
    await I.amOnPage(`/${projectPath(global.journeyProjectName)}`)
    await GitLabRepositoryPage.maskVolatile(global.journeyProjectName)
  }, 'gitlab-main-readme')
  await assertBranchExists('main')
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
  await addStoryboardFrame(I, await captureTerminalFrame(I, frameName, { fromMarker: prompt }))
}

storyboardStep(Given, 'a developer has just cloned a brand-new empty project into the terminal', async () => {
  await ensureLambdaUser()
  await openBlankProjectTerminal()
  prepareWorkingBranchInstaller(global.journeyContainer)
  preinstallToolchain(global.journeyContainer)
  authenticateGlab(global.journeyContainer, global.journeyLambdaToken)
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

storyboardStep(When, 'the developer keeps Docker as the container runtime', () => captureCopierQuestion('Enter', 'Which container runtime would you like to use?', 'copier-runtime'))

storyboardStep(When, 'the developer keeps the generated docker-compose file', () => captureCopierQuestion('Enter', 'Generate a docker-compose.yml file', 'copier-compose'))

storyboardStep(When, 'the developer keeps the project workspace enabled', () => captureCopierQuestion('Enter', 'Enable the project workspace?', 'copier-workspace'))

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
// Piped-install storyboard — @fresh-machine (chapter 2).
// The documented `curl … | bash` transport: inside the pty the installer's
// stdin is a PIPE, so the Copier questions only stay interactive through its
// /dev/tty fallback. Three cards prove it end to end — the blank clone, the
// scope prompt rendered THROUGH the pipe, and the same completion screen +
// framework MR the typed install produces (REST- and log-twinned). Per-scenario
// baselines, so parallel workers never share actual paths.
// ============================================

storyboardStep(Given, 'a developer follows the README and pipes the installer into bash', async () => {
  await ensureLambdaUser()
  await openBlankProjectTerminal()
  prepareWorkingBranchInstaller(global.journeyContainer, { piped: true })
  preinstallToolchain(global.journeyContainer)
  authenticateGlab(global.journeyContainer, global.journeyLambdaToken)
  await typeCommandAndWait(I, 'clear')
  await typeCommandAndWait(I, 'git status')
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-blank-clone', { fromMarker: 'git status' }))
})

storyboardStep(When, 'the installer still asks what to install, even when piped into bash', async () => {
  await launchWorkingBranchInstaller()
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-installer-scope', { fromMarker: `bash ${WRAPPER_PATH}` }))
})

storyboardStep(Then, 'the piped install finishes and opens the framework merge request', async () => {
  await answerAndCompleteInstaller()
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'terminal-installer-complete', { fromMarker: 'Installation complete!' }))
  assertInstallLog('Installation complete!')
  await assertBranchExists('init-framework-devsecops')
  await findOpenMr('init-framework-devsecops', 'main')
})
