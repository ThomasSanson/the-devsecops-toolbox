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
  getMergeRequest,
  mergeMergeRequest,
  updateProjectSettings,
  listRepositoryTree
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
  assertOrUpdateBaseline,
  assertTerminalVisualMatch,
  captureTerminalFrame,
  capturePageFrame,
  COMMAND_TIMEOUT_MS
} = require('../terminal/capture')
const storyboard = require('../../../../../.config/codeceptjs/storyboard')

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
      const dest = path.join(E2E_OUTPUT, 'gitlab', '01-developer-journey', logName)
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

Given('a fresh Ubuntu web terminal cloned from a freshly created blank GitLab project', async () => {
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
})

Given('the working-branch installer is staged in the terminal', () => {
  prepareWorkingBranchInstaller(global.journeyContainer)
})

// Pre-install the bootstrap toolchain off-camera so the installer's own toolchain
// step collapses to a few "already installed" lines (dropped as capture noise),
// keeping the agent-mode session compact enough to frame the whole before/during/
// after story in one deterministic screenshot.
Given('the toolchain is already installed', () => {
  preinstallToolchain(global.journeyContainer)
})

Given('the working-branch installer is staged in direct mode in the terminal', () => {
  prepareWorkingBranchInstaller(global.journeyContainer, { direct: true })
})

Given('the working-branch installer is staged in piped mode in the terminal', () => {
  prepareWorkingBranchInstaller(global.journeyContainer, { piped: true })
})

Given('glab is authenticated against the test GitLab', () => {
  authenticateGlab(global.journeyContainer, global.journeyLambdaToken)
})

// ============================================
// WHEN — drive the live terminal
// ============================================

When('I display the cloned project state in the terminal', async () => {
  await typeCommandAndWait(I, 'clear; git status')
})

When('I display the project tree in the terminal', async () => {
  // Full depth (the rendered .agent/ tree bottoms out at skills/<name>/SKILL.md)
  // so every guardrail file is visible — rules/, workflows/ AND each skill's
  // SKILL.md — not just the skill folder names. Excludes the .git plumbing.
  await typeCommandAndWait(I, "clear; tree -a -I '.git'")
})

// cspell vocabulary survives a toolbox update — the real Renovate-driven flow in
// a live, coloured terminal. A project generated from an EARLIER toolbox version
// (single-file config.json, the project's word crammed in) receives the update
// Renovate triggers (`task copier:update`), which splits the dictionary and moves
// the project's word into its own file. Real command, real conditions.
Given('a live terminal on a project from an earlier toolbox version with its word {string}', async (word) => {
  global.journeyContainer = setupCspellUpdateTerminal(word)
  I.amOnPage(`http://${global.journeyContainer}:${ttydPort()}`) // DevSkim: ignore DS162092
  I.waitForElement('.xterm-screen', 10)
  I.wait(3)
})

When('the developer runs the toolbox update in the terminal', async () => {
  // Real commands, each labelled by a trailing `# comment` (no extra echo lines).
  // The toolbox version comes from copier's own `_commit` in the answers file, so
  // the screenshot proves we go from 22.0.0 to 22.7.1 around the real update. `ls -1`
  // lists one file per line (humans read top-to-bottom); `jq` colours the words.
  await typeCommandAndWait(I, 'clear')
  await typeCommandAndWait(I, '# a generated project keeps its own cspell words across a toolbox update')
  await typeCommandAndWait(I, 'grep _commit .config/devsecops/.copier-answers.yml   # toolbox version BEFORE')
  await typeCommandAndWait(I, 'ls -1 .config/cspell/   # one framework-owned file')
  await typeCommandAndWait(I, "jq '.words[-4:]' .config/cspell/config.json   # the project word (Caddyfile), crammed in among the framework's")
  await typeCommandAndWait(I, "task copier:update TASK_COPIER_CLI_OPTS='--skip-answered --defaults --quiet --vcs-ref 22.7.1'", 240000)
  await typeCommandAndWait(I, 'grep _commit .config/devsecops/.copier-answers.yml   # toolbox version AFTER')
  await typeCommandAndWait(I, 'ls -1 .config/cspell/   # three files now')
  await typeCommandAndWait(I, "jq '.words[-4:]' .config/cspell/config.base.json   # the framework words: KEPT, in the framework's own file")
  await typeCommandAndWait(I, 'jq . .config/cspell/config.project.json   # the project word: MOVED to its own file')
  await typeCommandAndWait(I, "jq '.words' .config/cspell/config.json   # config.json: just the structural image now, word-free")
})

Then('the cspell update terminal should visually match {string}', async (baselineName) => {
  await assertTerminalVisualMatch(I, baselineName, { fromMarker: 'keeps its own cspell words across a toolbox update' })
})

When('I type the toolbox installer command in the terminal', async () => {
  I.click('.xterm-screen')
  I.type(`bash ${WRAPPER_PATH}`)
  await waitForTerminalSettle(I)
})

When('I launch the installer and wait for the prompt {string}', async (prompt) => {
  I.pressKey('Enter')
  await waitForTerminalText(I, prompt, COMMAND_TIMEOUT_MS)
})

When('I wait for the prompt {string}', async (prompt) => {
  await waitForTerminalText(I, prompt, COMMAND_TIMEOUT_MS)
})

When('I accept the default and wait for the prompt {string}', async (prompt) => {
  I.pressKey('Enter')
  await waitForTerminalText(I, prompt, COMMAND_TIMEOUT_MS)
})

When('I accept the last default and wait for scaffolding to complete', async () => {
  I.pressKey('Enter')
  // Poll the PERSISTENT log rather than the visible terminal: once the last
  // question is answered, copier scaffolds and `task devsecops:init` floods the
  // screen, scrolling the success line out of the viewport before it can be
  // seen. The log keeps everything.
  const deadline = Date.now() + 180000
  let found = false
  while (Date.now() < deadline) {
    const res = execInContainerAsUser(
      global.journeyContainer,
      'bootstrap',
      `grep -c "scaffolded successfully" ${INSTALL_LOG} 2>/dev/null || true`
    )
    if (parseInt((res.output || '0').trim(), 10) > 0) { found = true; break }
    await I.wait(3)
  }
  if (!found) {
    throw new Error('Copier did not report "scaffolded successfully" in the install log within 180s')
  }
})

When('I wait for the installer to finish', async () => {
  // After scaffolding, install.sh runs `task devsecops:init` (dev environment
  // setup + GitLab configuration), then prints its final lines. Poll the log
  // for install.sh's own completion marker (NOT the glab sub-installer's
  // "Installation complete!", which appears earlier).
  const deadline = Date.now() + 600000
  let found = false
  while (Date.now() < deadline) {
    const res = execInContainerAsUser(
      global.journeyContainer,
      'bootstrap',
      `grep -c "Run 'task' to see available commands" ${INSTALL_LOG} 2>/dev/null || true`
    )
    if (parseInt((res.output || '0').trim(), 10) > 0) { found = true; break }
    await I.wait(5)
  }
  if (!found) {
    throw new Error("Installer did not reach \"Run 'task' to see available commands\" within 600s")
  }
})

// ============================================
// THEN — proofs
// ============================================

Then('the developer terminal should visually match {string}', async (baselineName) => {
  await assertTerminalVisualMatch(I, baselineName)
})

// Marker-anchored capture: keeps only the rows from `marker` downward, so the
// non-deterministic install scrollback above an interactive prompt is excluded.
Then('the terminal from {string} should visually match {string}', async (marker, baselineName) => {
  await assertTerminalVisualMatch(I, baselineName, { fromMarker: marker })
})

// Bounded milestone capture: anchor on `marker`, keep exactly `lines` rows, so a
// deterministic block (e.g. setup/scaffold) is isolated from the
// non-deterministic toolchain output around it.
Then('the milestone block from {string} for {int} lines should visually match {string}', async (marker, lines, baselineName) => {
  await assertTerminalVisualMatch(I, baselineName, { fromMarker: marker, maxRows: lines })
})

Then('the install log should contain {string}', (expected) => {
  const result = execInContainerAsUser(global.journeyContainer, 'bootstrap', `cat ${INSTALL_LOG}`)
  const cleaned = stripAnsiEscapeSequences(result.output || '')
  if (!cleaned.includes(expected)) {
    throw new Error(
      `Expected install log to contain ${JSON.stringify(expected)}\n` +
      `--- install.log (cleaned, tail) ---\n${cleaned.slice(-2000)}\n---`
    )
  }
})

Then('the install log should report at least {int} created files', (min) => {
  const result = execInContainerAsUser(global.journeyContainer, 'bootstrap', `cat ${INSTALL_LOG}`)
  const cleaned = stripAnsiEscapeSequences(result.output || '')
  const count = cleaned.split('\n').filter(line => /^\s*create\s+\S/.test(line)).length
  if (count < min) {
    throw new Error(`Expected Copier to scaffold at least ${min} files, the install log reports ${count}`)
  }
})

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

Given('a fresh Ubuntu web terminal cloned from a GitLab project that already has a main branch', async () => {
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
})

Given('the terminal is checked out on a feature branch {string}', (branch) => {
  const res = execInContainerAsUser(global.journeyContainer, 'bootstrap', [
    `cd ${PROJECT_DIR}`,
    `git checkout -b ${shellEscape(branch)}`
  ].join('\n'))
  if (res.exitCode !== 0) {
    throw new Error(`Failed to checkout feature branch "${branch}":\n${res.output}`)
  }
})

When('I run the working-branch installer to completion', async () => {
  // Re-open the live terminal (a GitLab-page capture may have navigated away).
  I.amOnPage(`http://${global.journeyContainer}:${ttydPort()}`) // DevSkim: ignore DS162092
  I.waitForElement('.xterm-screen', 10)
  I.wait(2)
  I.click('.xterm-screen')
  I.type(`bash ${WRAPPER_PATH}`)
  I.pressKey('Enter')
  // First decision (gum/glow layer): accept the complete-framework install
  // (gum confirm binds 'y' to the affirmative), so the journey proceeds to the
  // Copier questionnaire.
  await waitForTerminalText(I, SCOPE_PROMPT, COMMAND_TIMEOUT_MS)
  await waitForTerminalSettle(I)
  I.pressKey('y')
  // Accept every Copier question with its default.
  for (const prompt of COPIER_PROMPTS) {
    await waitForTerminalText(I, prompt, COMMAND_TIMEOUT_MS)
    I.pressKey('Enter')
  }
  // Then init runs (bootstrap main + init-framework-devsecops branch + MR +
  // GitLab config) and install.sh prints its final marker. Poll the log.
  const deadline = Date.now() + 600000
  let done = false
  while (Date.now() < deadline) {
    const res = execInContainerAsUser(
      global.journeyContainer, 'bootstrap',
      `grep -c "Run 'task' to see available commands" ${INSTALL_LOG} 2>/dev/null || true`
    )
    if (parseInt((res.output || '0').trim(), 10) > 0) { done = true; break }
    await I.wait(5)
  }
  if (!done) {
    throw new Error("Installer did not finish (no \"Run 'task' to see available commands\" in the log within 600s)")
  }
})

// ============================================
// Selective install — gum/glow scope selection (agent mode)
// ============================================

// Accept the first gum confirm (install everything). gum confirm binds 'y' to
// the affirmative action, so the journey proceeds to the Copier questionnaire.
When('I choose to install the complete framework', async () => {
  await waitForTerminalSettle(I)
  I.pressKey('y')
})

// ============================================
// Agent-mode storyboard — ONE Gherkin line = ONE storyboard panel.
// storyboardWhen registers the step AND opens a panel whose title IS the
// step's own Gherkin text: the same string declares the scenario line and
// captions the image, so the feature and the storyboard can never drift
// apart. Each panel holds the real frames captured during its step, plus an
// optional human note and the copyable command/URL that reproduces the step.
// The storyboard module (.config/codeceptjs/storyboard.js, registered as a
// plugin) fills the header from the Gherkin metadata and renders the SVG.
// ============================================

function storyboardWhen (pattern, opts, fn) {
  When(pattern, async (...args) => {
    storyboard.panel(pattern, opts)
    await fn(...args)
  })
}

// The fresh project on GitLab, README only. Public project -> stable anonymous
// view; volatile content is masked. The shorter viewport keeps the panel
// focused on the file tree (the masked header is hidden).
storyboardWhen('the developer opens the fresh project on GitLab', {
  note: 'The blank project as cloned: a README and nothing else. Volatile content (dates, avatars, project name) is masked for determinism.',
  copy: 'http://gitlab/<lambda-user>/<project>'
}, async () => {
  I.resizeWindow(1024, 640)
  await I.amOnPage(`/${projectPath(global.journeyProjectName)}`)
  await GitLabRepositoryPage.maskVolatile(global.journeyProjectName)
  storyboard.frame(await capturePageFrame(I, 'agent-mode-gitlab-before'))
  I.resizeWindow(1024, 768)
})

// Back to the live terminal — a NEW shell session (the GitLab capture navigated
// away); the cloned repo state lives on disk, not in the session.
storyboardWhen('the developer checks out the cloned project in the terminal', {
  note: 'A fresh shell in the web terminal: the clone carries only the README, git is clean.',
  copy: 'ls -A1 && git status'
}, async () => {
  I.amOnPage(`http://${global.journeyContainer}:${ttydPort()}`) // DevSkim: ignore DS162092
  I.waitForElement('.xterm-screen', 10)
  I.wait(3)
  await typeCommandAndWait(I, 'clear')
  await typeCommandAndWait(I, 'ls -A1')
  await typeCommandAndWait(I, 'git status')
  storyboard.frame(await captureTerminalFrame(I, 'terminal-1-clone'))
})

// The frame is anchored on the TYPED COMMAND (the story must show what was
// executed), and ArrowRight moves the gum focus onto "Choose components"
// BEFORE the capture, so the image shows the choice the developer actually
// makes — not the default-highlighted "Install everything".
storyboardWhen('the developer launches the installer and chooses to pick components', {
  note: 'The installer opens the gum scope prompt; focus is moved onto "Choose components" before answering.',
  copy: `bash ${WRAPPER_PATH}`
}, async () => {
  I.click('.xterm-screen')
  I.type(`bash ${WRAPPER_PATH}`)
  I.pressKey('Enter')
  await waitForTerminalText(I, SCOPE_PROMPT, COMMAND_TIMEOUT_MS)
  await waitForTerminalSettle(I)
  I.pressKey('ArrowRight')
  await waitForTerminalSettle(I)
  storyboard.frame(await captureTerminalFrame(I, 'terminal-2-choice', { fromMarker: `bash ${WRAPPER_PATH}` }))
})

// Submit the focused "Choose components" -> the live checklist, captured while
// it is on screen (it erases itself on answer), then take the highlighted
// component with the natural Enter.
storyboardWhen('the developer takes the agent component from the checklist', {
  note: 'Single-select list: Enter takes the highlighted agent component — no empty-handed multi-select trap.'
}, async () => {
  I.pressKey('Enter')
  await waitForTerminalText(I, 'Select the component to install', COMMAND_TIMEOUT_MS)
  await waitForTerminalSettle(I)
  storyboard.frame(await captureTerminalFrame(I, 'terminal-3-checklist', { fromMarker: 'Select the component to install' }))
  I.pressKey('Enter')
})

// The install runs to its end marker (or the "Nothing selected" trap on a buggy
// build — the working-tree Then is the loud signal), then the local result:
// full-depth tree (no -L) because the guardrails bottom out at
// skills/<name>/SKILL.md and a shallower listing would hide those files.
storyboardWhen('the installer delivers only the AI agent guardrails', {
  note: 'The installer confirms what it delivered: the AI agent context only.'
}, async () => {
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
  storyboard.frame(await captureTerminalFrame(I, 'terminal-4-installed', { fromMarker: 'Installing agent mode' }))
  await typeCommandAndWait(I, 'ls -A1')
  await typeCommandAndWait(I, "tree -a -I '.git'")
  storyboard.frame(await captureTerminalFrame(I, 'terminal-4b-delivered', { fromMarker: 'ls -A1' }), {
    note: 'The resulting working tree: .agent/, CLAUDE.md, AGENTS.md — none of the framework.',
    copy: "ls -A1 && tree -a -I '.git'"
  })
})

// The GitLab hook: agent mode goes straight to main (no MR). Off-camera, point
// origin at a token-free URL backed by a credential store so the push never
// renders the PAT; on-camera, commit + push -q + list the REMOTE main.
storyboardWhen('the developer pushes the guardrails to main', {
  note: 'Agent mode goes straight to main (no MR); the remote tree lists the guardrails.',
  copy: 'git add -A && git commit -q -m "chore: install the AI agent guardrails" && git push -q origin main'
}, async () => {
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
  storyboard.frame(await captureTerminalFrame(I, 'terminal-5-push', { fromMarker: 'git add -A' }))
})

// The same project page now carries the guardrails, then the .agent tree
// itself (the repo root alone would hide what agent mode actually shipped).
storyboardWhen('the developer reviews the guardrails on GitLab main', {
  note: 'The same project page now carries the guardrails on main, committed as "chore: install the AI agent guardrails".',
  copy: 'http://gitlab/<lambda-user>/<project>'
}, async () => {
  const gitlabPath = `/${projectPath(global.journeyProjectName)}`
  I.resizeWindow(1024, 640)
  await I.amOnPage(gitlabPath)
  await GitLabRepositoryPage.maskVolatile(global.journeyProjectName)
  storyboard.frame(await capturePageFrame(I, 'agent-mode-gitlab-after'))
  await I.amOnPage(`${gitlabPath}/-/tree/main/.agent`)
  await GitLabRepositoryPage.maskVolatile(global.journeyProjectName)
  storyboard.frame(await capturePageFrame(I, 'agent-mode-gitlab-after-agent-tree'), {
    note: 'The .agent tree itself: rules, skills and workflows agent mode shipped.',
    copy: 'http://gitlab/<lambda-user>/<project>/-/tree/main/.agent'
  })
  I.resizeWindow(1024, 768)
})

// Per-frame visual regression + the storyboard SVG artifact.
// Every frame captured by the panels above is asserted against its OWN
// baseline under screenshots/base/<baseDir>/ (tolerance:0). The SVG — real
// selectable text around the untouched frames — is rendered to _output on
// every run (even a failing one: it shows what actually happened), and in
// baseline-update mode the committed copy — <baseDir>.svg NEXT TO its frame
// baselines, inside screenshots/ so the container-to-host artifact sync
// carries it — is rebuilt from the reviewed baselines so it never embeds
// unreviewed pixels.
Then('every step of the journey should visually match its baseline frame in {string}', async (baseDir) => {
  const panels = storyboard.panels()
  if (!panels.length) throw new Error('No storyboard panels were captured before the visual assert')

  storyboard.render(path.join(E2E_OUTPUT, `${baseDir}.svg`))

  for (const panel of panels) {
    for (const image of panel.images) {
      const name = `${baseDir}/${path.basename(image.file, '.png')}`
      const actualPath = path.join(E2E_OUTPUT, `${name}.png`)
      fs.mkdirSync(path.dirname(actualPath), { recursive: true })
      fs.copyFileSync(image.file, actualPath)
      await assertOrUpdateBaseline(I, name)
    }
  }

  if (process.env.TASK_E2E_UPDATE_BASELINES) {
    const baseRoot = path.resolve(E2E_OUTPUT, '..', 'screenshots', 'base')
    storyboard.render(path.join(baseRoot, `${baseDir}.svg`), {
      imageDir: path.join(baseRoot, baseDir)
    })
  }
})

// The whole point of agent mode: the installer ADDS only the AI agent context
// (.agent/, CLAUDE.md, AGENTS.md) — none of the framework, no Copier bookkeeping
// — while leaving the repo's own files (the README it was cloned with) intact.
Then('the project working tree should contain only the AI agent context files', () => {
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

Then('the project should have a branch {string}', async (branch) => {
  const headers = await getRootHeaders()
  const res = await listProjectBranches(global.journeyProjectName, headers)
  const names = (res.data || []).map(b => b.name)
  if (!names.includes(branch)) {
    throw new Error(`Branch "${branch}" not found for ${global.journeyProjectName}. Branches: ${JSON.stringify(names)}`)
  }
})

Then('the project should not have a branch {string}', async (branch) => {
  const headers = await getRootHeaders()
  const res = await listProjectBranches(global.journeyProjectName, headers)
  const names = (res.data || []).map(b => b.name)
  if (names.includes(branch)) {
    throw new Error(`Branch "${branch}" should NOT exist for ${global.journeyProjectName}, but it does. Branches: ${JSON.stringify(names)}`)
  }
})

Then('no merge request should be open for the project', async () => {
  const headers = await getRootHeaders()
  const res = await listProjectMergeRequests(global.journeyProjectName, headers, '?state=opened')
  const open = res.data || []
  if (open.length > 0) {
    throw new Error(
      `Expected no open merge request for ${global.journeyProjectName}, found ${open.length}: ` +
      JSON.stringify(open.map(m => `${m.source_branch}->${m.target_branch}`))
    )
  }
})

Then('a merge request from {string} into {string} should be open for the project', async (source, target) => {
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
})

Then('the merge request page should visually match {string}', async (baselineName) => {
  await GitLabMergeRequestPage.verifyMergeRequestVisual(
    projectPath(global.journeyProjectName),
    global.journeyMergeRequestIid,
    baselineName,
    global.journeyProjectName
  )
})

Then('a project access token {string} must exist with Maintainer role for the journey project', async (tokenName) => {
  const headers = await getRootHeaders()
  const tokens = await listProjectAccessTokens(global.journeyProjectName, headers)
  const token = (tokens.data || []).find(t => t.name === tokenName && t.active && !t.revoked)
  if (!token) {
    throw new Error(`Active token "${tokenName}" not found for ${global.journeyProjectName}`)
  }
  if (token.access_level < 40) {
    throw new Error(`Token "${tokenName}" has access_level=${token.access_level}, expected >= 40 (Maintainer)`)
  }
})

Then('the branch {string} must be protected with merge for maintainers and push for no one for the journey project', async (branch) => {
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
})

// ============================================
// GitLab repository views (visual regression)
// ============================================

Then('the empty project page should visually match {string}', async (baselineName) => {
  await GitLabRepositoryPage.verifyEmptyProjectVisual(
    projectPath(global.journeyProjectName), global.journeyProjectName, baselineName
  )
})

Then('the project home page should visually match {string}', async (baselineName) => {
  await GitLabRepositoryPage.verifyProjectHomeVisual(
    projectPath(global.journeyProjectName), global.journeyProjectName, baselineName
  )
})

Then('the branches page should visually match {string}', async (baselineName) => {
  await GitLabRepositoryPage.verifyBranchesVisual(
    projectPath(global.journeyProjectName), global.journeyProjectName, baselineName
  )
})

// The MR diff content IS the (volatile, self-hosting) repo content, so a
// pixel baseline of it drifts; assert it carries changed files via REST instead.
Then('the merge request should report changed files', async () => {
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
})

// ============================================
// Stage 5 — the reviewer merges the framework MR
// ============================================

Given('the merge gate on pipelines is lifted for the journey project', async () => {
  // The test GitLab has no CI runner, so the only_allow_merge_if_pipeline_succeeds
  // gate applied by init can never be satisfied here. Lifting it scopes the
  // merge to the mechanics this scenario proves (ff merge against the branch
  // protection); the pipeline gate itself would need a registered runner.
  const headers = await getRootHeaders()
  const res = await updateProjectSettings(
    global.journeyProjectName,
    { only_allow_merge_if_pipeline_succeeds: false },
    headers
  )
  if (res.status >= 400) {
    throw new Error(`Failed to lift the pipeline merge gate (${res.status}): ${JSON.stringify(res.data)}`)
  }
})

When('the merge request is merged as lambda', async () => {
  const headers = { 'PRIVATE-TOKEN': global.journeyLambdaToken }
  const res = await mergeMergeRequest(global.journeyProjectName, global.journeyMergeRequestIid, headers)
  if (res.status >= 400) {
    throw new Error(`Merge of MR !${global.journeyMergeRequestIid} failed (${res.status}): ${JSON.stringify(res.data)}`)
  }
})

Then('the merge request should be merged', async () => {
  const headers = await getRootHeaders()
  const deadline = Date.now() + 30000
  let state = null
  while (Date.now() < deadline) {
    const res = await getMergeRequest(global.journeyProjectName, global.journeyMergeRequestIid, headers)
    state = res.data && res.data.state
    if (state === 'merged') return
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error(`MR !${global.journeyMergeRequestIid} did not reach state "merged" within 30s (state=${state})`)
})

Then('the merged merge request page should visually match {string}', async (baselineName) => {
  await GitLabMergeRequestPage.verifyMergeRequestVisual(
    projectPath(global.journeyProjectName),
    global.journeyMergeRequestIid,
    baselineName,
    global.journeyProjectName
  )
})

Then('the branch {string} must contain the file {string} for the journey project', async (branch, file) => {
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
})

// ============================================
// GitLab configuration pages (logged in as lambda)
// ============================================

When('I am logged in to GitLab as lambda', async () => {
  await GitLabUserPage.loginAs(
    process.env.TASK_GITLAB_LAMBDA_USER,
    process.env.TASK_GITLAB_LAMBDA_PASSWORD
  )
})

Then('the access tokens page should visually match {string}', async (baselineName) => {
  await GitLabAccessTokenPage.navigateToAccessTokenSettings(projectPath(global.journeyProjectName))
  await GitLabAccessTokenPage.verifyTokenWithMaintainerRole('TASK_COMMITIZEN_TOKEN')
  await GitLabAccessTokenPage.verifyVisualRegression(baselineName)
})

Then('the CI\\/CD variables page should visually match {string}', async (baselineName) => {
  await GitLabAccessTokenPage.navigateToCiCdSettings(projectPath(global.journeyProjectName))
  await GitLabAccessTokenPage.verifyCiCdVariable('TASK_COMMITIZEN_TOKEN')
  await GitLabAccessTokenPage.verifyVisualRegressionCiCd(baselineName)
})

Then('the merge request settings page should visually match {string}', async (baselineName) => {
  await GitLabSettingsPage.verifyMergeSettingsVisual(
    projectPath(global.journeyProjectName), global.journeyProjectName, baselineName
  )
})

Then('the protected branches page should visually match {string}', async (baselineName) => {
  await GitLabSettingsPage.verifyProtectedBranchVisual(
    projectPath(global.journeyProjectName), global.journeyProjectName, baselineName
  )
})
