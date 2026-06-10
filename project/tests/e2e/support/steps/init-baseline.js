/* global inject Given When Then */
/**
 * Pilot E2E scenario — `task devsecops:init` configures a fresh GitLab project.
 *
 * Establishes the canonical convention for the unified suite:
 *   1. Setup a realistic environment (GitLab + lambda user + fresh project).
 *   2. Run `task devsecops:init` in the project repo with output capture.
 *   3. Assert the terminal output visually (rendered <pre> in browser).
 *   4. Assert the GitLab effects via API + UI screenshots
 *      (Access Tokens page + CI/CD Variables page).
 */

const { I, GitLabAccessTokenPage } = inject()
const { execSync } = require('child_process')
const {
  BASE_URL,
  projectPath,
  getRootHeaders,
  createLambdaPersonalAccessToken,
  readProjectVariable,
  listProjectAccessTokens,
  rotateProjectAccessToken
} = require('../helpers/gitlabApi')
const {
  bootstrapWorkspaceRepo,
  runTaskInRepoCaptured
} = require('../helpers/workspaceRepo')
const { freshGet, freshPost } = require('../helpers/http')
const { assertPageVisualMatch } = require('../helpers/pageVisual')

// All scenarios that drive `task devsecops:init` on a fresh GitLab project
// share this convention: the working repo lives at /tmp/<projectName>-repo.
function repoDirFor (projectName) {
  return `/tmp/${projectName}-repo`
}

// Strip ANSI escape sequences before rendering captured output to keep the
// pixel-perfect baseline deterministic across runs.
function stripAnsi (str) {
  return str
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07]*\x07/g, '')
}

// Lines whose content varies between runs (timestamps, IDs, network info)
// must be filtered out before rendering, otherwise the visual baseline is
// brittle by design.
const TASK_OUTPUT_NOISE_PATTERNS = [
  /^\{"id":\d+/,
  /^🦊 Applying merge request settings/,
  /^task: \[/,
  // Token creation line carries the expiration date (90 days ahead) which
  // shifts every run. The success line ("Token created and CI/CD variable
  // ... stored") that follows is deterministic and sufficient as proof.
  /Creating new Project Access Token .*expires \d{4}-\d{2}-\d{2}/,
  // Lefthook iterates a Go map when emitting the hook list, so the order
  // (e.g. "(commit-msg, pre-commit)" vs "(pre-commit, commit-msg)") is
  // non-deterministic. The following "Lefthook:install phase completed
  // successfully" line is deterministic and sufficient proof.
  /^sync hooks: /
]

function filterTaskOutput (raw) {
  return stripAnsi(raw)
    .replace(/\r/g, '')
    // The duplicate-purge healing line carries the revoked token's numeric id,
    // which differs on every run — mask it so the verdict stays pixel-stable.
    .replace(/Revoked duplicate token #\d+/g, 'Revoked duplicate token #<id>')
    .split('\n')
    .filter(line => {
      const trimmed = line.trim()
      if (trimmed === '') return true
      return !TASK_OUTPUT_NOISE_PATTERNS.some(re => re.test(trimmed))
    })
}

function tailFromMarker (lines, marker, tail = 30) {
  const markerIdx = lines.reduce((last, line, idx) => (line.includes(marker) ? idx : last), -1)
  if (markerIdx < 0) return lines.slice(Math.max(0, lines.length - tail))
  const end = markerIdx + 1
  return lines.slice(Math.max(0, end - tail), end)
}

// ============================================
// GIVEN — Setup
// ============================================

Given('a GitLab runs in a container configured with user {string}', async () => {
  const title = await I.grabTitle()
  if (!title) {
    const { GitLabUserPage } = inject()
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
})

Given('a test repository {string} is created in GitLab', async (projectName) => {
  const { GitLabProjectPage, GitLabUserPage } = inject()

  await GitLabProjectPage.deleteProjectIfExists(
    BASE_URL,
    process.env.TASK_GITLAB_ROOT_USER,
    process.env.TASK_GITLAB_ROOT_PASSWORD,
    projectPath(projectName)
  )

  await GitLabUserPage.loginAs(
    process.env.TASK_GITLAB_LAMBDA_USER,
    process.env.TASK_GITLAB_LAMBDA_PASSWORD
  )

  await GitLabProjectPage.createBlankPublicProject(projectName)
})

// ============================================
// WHEN — Execute task devsecops:init
// ============================================

When('I run the command {string} for project {string} with local authentication', async (command, projectName) => {
  if (command !== 'task devsecops:init') {
    throw new Error(`Unexpected command: '${command}'`)
  }

  const rootHeaders = await getRootHeaders()
  const { token: glabToken } = await createLambdaPersonalAccessToken(
    `glab-cli-token-for-${projectName}`,
    ['api', 'write_repository'],
    rootHeaders
  )
  global.glabTokenByProject = global.glabTokenByProject || {}
  global.glabTokenByProject[projectName] = glabToken

  const repoDir = repoDirFor(projectName)

  // Phase 1 — clone the empty project, copy toolbox source, configure dev env
  // and glab auth. We do NOT run init here: we want the init output captured
  // separately so it can be rendered for visual regression.
  bootstrapWorkspaceRepo(projectName, repoDir, glabToken, {
    runInit: false,
    timeout: 300000
  })

  // Phase 2 — run task devsecops:init with captured stdout/stderr.
  // Retry ONCE if exit 201 (Taskfile sub-task failure) which we have only ever
  // observed under parallel apt/go install contention. Visual regressions
  // would fail both attempts identically, so the retry doesn't mask them.
  let result = runTaskInRepoCaptured('task devsecops:init', repoDir, glabToken, { timeout: 300000 })
  if (result.exitCode === 201) {
    result = runTaskInRepoCaptured('task devsecops:init', repoDir, glabToken, { timeout: 300000 })
  }
  global.lastTaskOutput = result.output
  global.lastTaskExitCode = result.exitCode

  if (result.exitCode !== 0) {
    throw new Error(`task devsecops:init failed with exit code ${result.exitCode}`)
  }
})

// ============================================
// Shared steps for idempotency / resync / clone scenarios
// ============================================

Given('the active token id of {string} is captured for project {string}', async (tokenName, projectName) => {
  const headers = await getRootHeaders()
  const tokens = await listProjectAccessTokens(projectName, headers)
  const active = tokens.data.find(t => t.name === tokenName && t.active && !t.revoked)
  if (!active) {
    throw new Error(`No active token named '${tokenName}' for project '${projectName}'`)
  }
  global.capturedTokenIds = global.capturedTokenIds || {}
  global.capturedTokenIds[`${projectName}:${tokenName}`] = active.id
})

Given('the CI\\/CD variable {string} value is saved for project {string}', async (variableName, projectName) => {
  const headers = await getRootHeaders()
  const variable = await readProjectVariable(projectName, variableName, headers)
  global.capturedVariableValues = global.capturedVariableValues || {}
  global.capturedVariableValues[`${projectName}:${variableName}`] = variable.data.value
})

When('I re-run {string} for project {string}', (command, projectName) => {
  if (command !== 'task devsecops:init') {
    throw new Error(`Unexpected command: '${command}'`)
  }
  const glabToken = (global.glabTokenByProject || {})[projectName]
  if (!glabToken) {
    throw new Error(`No glab token captured for project '${projectName}' (run the initial 'I run ... with local authentication' step first)`)
  }
  // Same retry-on-201 policy as the initial run — see comment in the
  // "I run the command ... with local authentication" step above.
  let result = runTaskInRepoCaptured('task devsecops:init', repoDirFor(projectName), glabToken, { timeout: 300000 })
  if (result.exitCode === 201) {
    result = runTaskInRepoCaptured('task devsecops:init', repoDirFor(projectName), glabToken, { timeout: 300000 })
  }
  global.lastTaskOutput = result.output
  global.lastTaskExitCode = result.exitCode
  if (result.exitCode !== 0) {
    throw new Error(`task devsecops:init re-run failed (exit ${result.exitCode}):\n${result.output}`)
  }
})

Then('the active token id of {string} must be unchanged for project {string}', async (tokenName, projectName) => {
  const headers = await getRootHeaders()
  const tokens = await listProjectAccessTokens(projectName, headers)
  const active = tokens.data.find(t => t.name === tokenName && t.active && !t.revoked)
  const previousId = (global.capturedTokenIds || {})[`${projectName}:${tokenName}`]
  if (!active) {
    throw new Error(`No active token named '${tokenName}' for project '${projectName}' after re-run`)
  }
  if (typeof previousId === 'undefined') {
    throw new Error('No previously-captured token id — call the capture step before re-running init')
  }
  if (active.id !== previousId) {
    throw new Error(
      `Token id was rotated by re-run (idempotency broken). Previous=${previousId}, current=${active.id}`
    )
  }
})

Then('the active token id of {string} must differ from the captured id for project {string}', async (tokenName, projectName) => {
  const headers = await getRootHeaders()
  const tokens = await listProjectAccessTokens(projectName, headers)
  const active = tokens.data.find(t => t.name === tokenName && t.active && !t.revoked)
  const previousId = (global.capturedTokenIds || {})[`${projectName}:${tokenName}`]
  if (!active) {
    throw new Error(`No active token named '${tokenName}' for project '${projectName}'`)
  }
  if (typeof previousId === 'undefined') {
    throw new Error('No previously-captured token id — call the capture step before this assertion')
  }
  if (active.id === previousId) {
    throw new Error(
      `Token id was NOT rotated despite expected re-sync. Token id stayed at ${active.id}`
    )
  }
})

Then('the CI\\/CD variable {string} must not have changed for project {string}', async (variableName, projectName) => {
  const headers = await getRootHeaders()
  const variable = await readProjectVariable(projectName, variableName, headers)
  const previousValue = (global.capturedVariableValues || {})[`${projectName}:${variableName}`]
  if (typeof previousValue === 'undefined') {
    throw new Error('No previously-captured variable value — call the save step before this assertion')
  }
  if (variable.data.value !== previousValue) {
    throw new Error(
      `CI/CD variable '${variableName}' was modified by re-run (idempotency broken).`
    )
  }
})

Then('only one active token named {string} must exist for {string}', async (tokenName, projectName) => {
  const headers = await getRootHeaders()
  const tokens = await listProjectAccessTokens(projectName, headers)
  const activeTokens = tokens.data.filter(t => t.name === tokenName && t.active && !t.revoked)
  if (activeTokens.length !== 1) {
    throw new Error(`Expected exactly 1 active token named '${tokenName}', found ${activeTokens.length}`)
  }
})

When('the access token {string} is rotated externally for project {string}', async (tokenName, projectName) => {
  const headers = await getRootHeaders()
  const tokens = await listProjectAccessTokens(projectName, headers)
  const active = tokens.data.find(t => t.name === tokenName && t.active && !t.revoked)
  if (!active) {
    throw new Error(`No active token named '${tokenName}' to rotate for project '${projectName}'`)
  }
  const rotated = await rotateProjectAccessToken(projectName, active.id, headers)
  if (rotated.status >= 400 || !rotated.data || !rotated.data.token) {
    throw new Error(`External rotation of '${tokenName}' failed (status=${rotated.status}): ${JSON.stringify(rotated.data)}`)
  }
})

When('I create an empty commit {string} in project {string}', (message, projectName) => {
  const repoDir = repoDirFor(projectName)
  try {
    const output = execSync(
      `git -C ${repoDir} commit --allow-empty -m ${JSON.stringify(message)}`,
      { stdio: 'pipe', timeout: 60000 }
    )
    global.lastCommitOutput = output.toString()
    global.lastCommitExitCode = 0
  } catch (error) {
    const stdout = error.stdout ? error.stdout.toString() : ''
    const stderr = error.stderr ? error.stderr.toString() : ''
    global.lastCommitOutput = `${stdout}${stderr}`
    global.lastCommitExitCode = error.status || 1
  }
})

Then('the commit must be accepted by the hooks', () => {
  if (global.lastCommitExitCode !== 0) {
    throw new Error(
      `Expected the commit to pass the hooks, got exit ${global.lastCommitExitCode}\n` +
      `--- output ---\n${global.lastCommitOutput}\n---`
    )
  }
})

Then('the commit must be rejected by the hooks', () => {
  if (global.lastCommitExitCode === 0) {
    throw new Error(
      'Expected the commit to be rejected by the hooks, but it succeeded.\n' +
      `--- output ---\n${global.lastCommitOutput}\n---`
    )
  }
})

// Patterns that drop bookkeeping noise lines from the commit output but
// keep the lines that prove the commit happened and the hooks ran.
const COMMIT_OUTPUT_NOISE_PATTERNS = [
  /^\s+\d+ files? changed/, // diff summary stats vary with empty/non-empty
  /^\s+\d+ insertion/,
  /^\s+\d+ deletion/,
  /^\s+create mode \d+/,
  /summary: \(done in /, //   lefthook timing footer
  /\(done in \d+\.\d+s\)/
]

When('the commit output is displayed in the browser', async () => {
  const raw = global.lastCommitOutput || ''
  // Mask the dynamic short SHA so "[main abc1234] message" becomes
  // "[main <sha>] message" — keeps the contract visible without churn.
  const masked = stripAnsi(raw).replace(/\[(main|master|HEAD) [0-9a-f]{7,}\]/g, '[$1 <sha>]')
  const lines = masked
    .replace(/\r/g, '')
    .split('\n')
    .filter(line => {
      const trimmed = line.trim()
      if (trimmed === '') return true
      return !COMMIT_OUTPUT_NOISE_PATTERNS.some(re => re.test(trimmed))
    })
  const output = lines.join('\n')

  await I.usePlaywrightTo('render commit output in browser', async ({ page }) => {
    await page.setContent(
      '<!DOCTYPE html><html><body style="background:#1e1e1e;margin:0;padding:16px">' +
      '<pre id="task-output" style="color:#d4d4d4;font-family:monospace;font-size:14px;line-height:1.4;white-space:pre-wrap;word-break:break-all">' +
      output.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
      '</pre></body></html>'
    )
  })
  await I.wait(0.5)
})

Then('the commit output should visually match {string}', async (baselineName) => {
  await assertPageVisualMatch(I, baselineName)
})

Then('I can git clone the project {string} using the {string} token', async (projectName, variableName) => {
  const headers = await getRootHeaders()
  const variable = await readProjectVariable(projectName, variableName, headers)
  const tokenValue = variable.data.value
  if (!tokenValue) {
    throw new Error(`CI/CD variable '${variableName}' is empty for project '${projectName}'`)
  }
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const cloneDir = `/tmp/${projectName}-clone-verification`
  try {
    execSync(`rm -rf ${cloneDir} && git clone http://${lambdaUser}:${tokenValue}@gitlab/${lambdaUser}/${projectName}.git ${cloneDir}`, {
      stdio: 'pipe',
      timeout: 120000
    })
  } catch (error) {
    const stderr = error.stderr ? error.stderr.toString() : ''
    throw new Error(`git clone using token '${variableName}' failed:\n${stderr}`)
  }
})

// ============================================
// THEN — Terminal visual proof (rendered <pre>)
// ============================================

When('the devsecops:init output is displayed in the browser', async () => {
  const raw = global.lastTaskOutput || ''
  const lines = filterTaskOutput(raw)
  const tail = tailFromMarker(lines, '✅ DevSecOps project initialization completed', 30)
  const output = tail.join('\n')

  await I.usePlaywrightTo('render devsecops:init output in browser', async ({ page }) => {
    await page.setContent(
      '<!DOCTYPE html><html><body style="background:#1e1e1e;margin:0;padding:16px">' +
      '<pre id="task-output" style="color:#d4d4d4;font-family:monospace;font-size:14px;line-height:1.4;white-space:pre-wrap;word-break:break-all">' +
      output.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
      '</pre></body></html>'
    )
  })
  await I.wait(0.5)
})

Then('the devsecops:init terminal output should visually match {string}', async (baselineName) => {
  await assertPageVisualMatch(I, baselineName)
})

// ============================================
// THEN — GitLab effect proofs
// ============================================

Then('a project access token {string} must exist with Maintainer role for {string}', async (tokenName, projectName) => {
  const headers = await getRootHeaders()
  const tokensResponse = await listProjectAccessTokens(projectName, headers)
  const matchingToken = tokensResponse.data.find(t => t.name === tokenName && t.active && !t.revoked)

  if (!matchingToken) {
    throw new Error(`Token '${tokenName}' not found for project '${projectPath(projectName)}'`)
  }
  if (matchingToken.access_level < 40) {
    throw new Error(`Token '${tokenName}' has access_level=${matchingToken.access_level}, expected >= 40 (Maintainer)`)
  }
})

Then('the GitLab access tokens page for {string} should visually match {string}', async (projectName, baselineName) => {
  await GitLabAccessTokenPage.navigateToAccessTokenSettings(projectPath(projectName))
  await GitLabAccessTokenPage.verifyTokenWithMaintainerRole('TASK_COMMITIZEN_TOKEN')
  await GitLabAccessTokenPage.verifyVisualRegression(baselineName)
})

Then('the CI\\/CD variable {string} must exist for project {string}', async (variableName, projectName) => {
  const headers = await getRootHeaders()
  const variableResponse = await readProjectVariable(projectName, variableName, headers)
  if (!variableResponse.data || !variableResponse.data.key) {
    throw new Error(`CI/CD variable '${variableName}' not found for project '${projectPath(projectName)}'`)
  }
})

Then('the GitLab CI\\/CD variables page for {string} should visually match {string}', async (projectName, baselineName) => {
  await GitLabAccessTokenPage.navigateToCiCdSettings(projectPath(projectName))
  await GitLabAccessTokenPage.verifyCiCdVariable('TASK_COMMITIZEN_TOKEN')
  await GitLabAccessTokenPage.verifyVisualRegressionCiCd(baselineName)
})

Then('the branch {string} must be protected with merge for maintainers and push for no one for {string}', async (branch, projectName) => {
  const tokenResponse = await freshPost(`${BASE_URL}/oauth/token`, {
    grant_type: 'password',
    username: process.env.TASK_GITLAB_ROOT_USER,
    password: process.env.TASK_GITLAB_ROOT_PASSWORD
  })
  const headers = { Authorization: `Bearer ${tokenResponse.data.access_token}` }

  const encodedPath = encodeURIComponent(projectPath(projectName))
  const branchResponse = await freshGet(
    `${BASE_URL}/api/v4/projects/${encodedPath}/protected_branches/${branch}`,
    headers
  )
  const data = branchResponse.data

  const mergeLevel = (data.merge_access_levels || []).find(l => l.access_level === 40)
  if (!mergeLevel) {
    throw new Error(
      `Expected merge_access_levels to contain access_level=40 (Maintainers), got: ${JSON.stringify(data.merge_access_levels)}`
    )
  }

  const pushLevel = (data.push_access_levels || []).find(l => l.access_level === 0)
  if (!pushLevel) {
    throw new Error(
      `Expected push_access_levels to contain access_level=0 (No one), got: ${JSON.stringify(data.push_access_levels)}`
    )
  }
})
