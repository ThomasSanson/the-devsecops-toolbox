/* global inject Before After Given When Then */
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
  prepareWorkingBranchInstaller,
  authenticateGlab,
  teardownJourneyTerminal
} = require('../helpers/journeyContainer')
const {
  typeCommandAndWait,
  waitForTerminalText,
  waitForTerminalSettle,
  assertTerminalVisualMatch,
  COMMAND_TIMEOUT_MS
} = require('../terminal/capture')

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

// Decline the first gum confirm: gum confirm binds 'n' to the negative action,
// which opens the component selection — a multi-select checklist (one component
// today, designed to grow).
When('I decline installing the complete framework', async () => {
  await waitForTerminalSettle(I)
  I.pressKey('n')
})

// In the gum multi-select checklist, toggle the agent component with the space
// bar, confirm with enter, then poll the persistent log until the installer
// reports the agent context was installed.
When('I select the agent component and wait for the installer to finish', async () => {
  await waitForTerminalSettle(I)
  I.pressKey('Space')
  await waitForTerminalSettle(I)
  I.pressKey('Enter')
  const deadline = Date.now() + 300000
  let done = false
  while (Date.now() < deadline) {
    const res = execInContainerAsUser(
      global.journeyContainer, 'bootstrap',
      `grep -c ${shellEscape(AGENT_DONE_MARKER)} ${INSTALL_LOG} 2>/dev/null || true`
    )
    if (parseInt((res.output || '0').trim(), 10) > 0) { done = true; break }
    await I.wait(3)
  }
  if (!done) {
    throw new Error(`Installer did not report "${AGENT_DONE_MARKER}" in the log within 300s`)
  }
})

// The whole point of agent mode: the working tree carries ONLY the AI agent
// context (.agent/, CLAUDE.md, AGENTS.md) — none of the framework, and no
// Copier bookkeeping (.config/.copier-answers.yml).
Then('the project working tree should contain only the AI agent context files', () => {
  const res = execInContainerAsUser(
    global.journeyContainer, 'bootstrap',
    `cd ${PROJECT_DIR} && ls -A1 | grep -v '^.git$' | sort`
  )
  const entries = stripAnsiEscapeSequences(res.output || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  const expected = ['.agent', 'AGENTS.md', 'CLAUDE.md']
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
