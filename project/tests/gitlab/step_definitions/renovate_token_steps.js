/* global inject Given When Then */
const { I, GitLabAccessTokenPage } = inject()
const { execSync } = require('child_process')
const {
  BASE_URL,
  projectPath,
  getRootHeaders,
  createLambdaPersonalAccessToken,
  readProjectVariable,
  updateProjectVariable,
  listProjectAccessTokens,
  createProjectAccessToken,
  revokeProjectAccessToken,
  rotateProjectAccessToken,
  deleteProjectVariable,
  createProjectVariable
} = require('../helpers/gitlabApi')
const {
  bootstrapWorkspaceRepo,
  runTaskInRepoCaptured
} = require('../helpers/workspaceRepo')

// Strip ANSI color/control sequences before rendering the captured output
// in the browser so the visual baseline stays deterministic.
function stripAnsi (str) {
  return str
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07]*\x07/g, '')
}

// Lines whose content varies between runs and would defeat a pixel-perfect
// terminal regression. Filtered out before rendering the captured output.
// glab api JSON dump for project, the merge-request settings banner that
// follows it, and taskfile task header lines.
const TASK_OUTPUT_NOISE_PATTERNS = [
  /^\{"id":\d+/,
  /^🦊 Applying merge request settings/,
  /^task: \[/
]

function filterTaskOutput (raw) {
  return stripAnsi(raw)
    .replace(/\r/g, '')
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
// GIVEN - Setup test user and project
// ============================================

Given('a GitLab runs in a container configured with user {string}', async (userName) => {
  // Ensure lambda user exists
  const I = inject().I
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

  // Delete project if exists
  await GitLabProjectPage.deleteProjectIfExists(
    BASE_URL,
    process.env.TASK_GITLAB_ROOT_USER,
    process.env.TASK_GITLAB_ROOT_PASSWORD,
    projectPath(projectName)
  )

  // Login as lambda user
  await GitLabUserPage.loginAs(process.env.TASK_GITLAB_LAMBDA_USER, process.env.TASK_GITLAB_LAMBDA_PASSWORD)

  // Create fresh project
  await GitLabProjectPage.createBlankPublicProject(projectName)
})

// ============================================
// WHEN - Create project access token
// ============================================

When('I run the command {string} for project {string} with local authentication', async (command, projectName) => {
  if (command !== 'task devsecops:init') {
    throw new Error(`Unexpected command: '${command}'`)
  }

  const rootHeaders = await getRootHeaders()
  const glabToken = await createLambdaPersonalAccessToken(
    'glab-cli-token-for-test',
    ['api', 'write_repository'],
    rootHeaders
  )
  bootstrapWorkspaceRepo(projectName, '/tmp/test-repo', glabToken, {
    runInit: true,
    timeout: 300000
  })

  // 8. Retrieve the generated token from CI/CD variables for clone verification
  const varResponse = await readProjectVariable(projectName, 'TASK_RENOVATE_TOKEN', rootHeaders)
  global.renovateTokenForClone = varResponse.data.value
})

// ============================================
// THEN - Verify token and CI/CD variables
// ============================================

Then('a Renovate token {string} must exist with Maintainer role for {string}', async (tokenName, projectName) => {
  await GitLabAccessTokenPage.navigateToAccessTokenSettings(projectPath(projectName))
  await GitLabAccessTokenPage.verifyTokenWithMaintainerRole(tokenName)
  await GitLabAccessTokenPage.verifyVisualRegression()
})

Then('the token must be present in the project CI\\/CD variables for {string}', async (projectName) => {
  await GitLabAccessTokenPage.navigateToCiCdSettings(projectPath(projectName))
  await GitLabAccessTokenPage.verifyCiCdVariable('TASK_RENOVATE_TOKEN')
  await GitLabAccessTokenPage.verifyVisualRegressionCiCd()
})

Given('the CI\\/CD variable {string} value is saved for project {string}', async (variableName, projectName) => {
  const headers = await getRootHeaders()
  const varResponse = await readProjectVariable(projectName, variableName, headers)
  global.savedCiVariableValue = varResponse.data.value
})

Then('the CI\\/CD variable {string} must not have changed for project {string}', async (variableName, projectName) => {
  const headers = await getRootHeaders()
  const varResponse = await readProjectVariable(projectName, variableName, headers)

  if (varResponse.data.value !== global.savedCiVariableValue) {
    throw new Error(
      `CI/CD variable '${variableName}' was modified (token was rotated). ` +
      'Expected idempotent behavior — the value should not change when token and variable are in sync.'
    )
  }
})

Given('the user {string} is logged in to GitLab', async (userName) => {
  const { GitLabUserPage } = inject()
  const password = process.env.TASK_GITLAB_LAMBDA_PASSWORD
  await GitLabUserPage.loginAs(userName, password)
})

When('the Renovate access token {string} is revoked from project {string}', async (tokenName, projectName) => {
  const headers = await getRootHeaders()
  const tokensResponse = await listProjectAccessTokens(projectName, headers)

  for (const token of tokensResponse.data) {
    if (token.name === tokenName && token.active && !token.revoked) {
      await revokeProjectAccessToken(projectName, token.id, headers)
    }
  }
})

When('the CI\\/CD variable {string} is tampered with for project {string}', async (variableName, projectName) => {
  const headers = await getRootHeaders()
  await updateProjectVariable(
    projectName,
    variableName,
    { value: 'glpat-invalid-tampered-value', masked: true }, // gitleaks:allow
    headers
  )
})

When('the access token {string} is rotated externally for project {string}', async (tokenName, projectName) => {
  const headers = await getRootHeaders()
  const tokensResponse = await listProjectAccessTokens(projectName, headers)
  const matchingToken = tokensResponse.data.find(t => t.name === tokenName && t.active && !t.revoked)

  if (!matchingToken) {
    throw new Error(`Cannot rotate: no active token named '${tokenName}' for project '${projectName}'`)
  }

  const rotateResponse = await rotateProjectAccessToken(projectName, matchingToken.id, headers)
  if (rotateResponse.status >= 400 || !rotateResponse.data || !rotateResponse.data.token) {
    throw new Error(
      `Failed to rotate token '${tokenName}' (status=${rotateResponse.status}): ${JSON.stringify(rotateResponse.data)}`
    )
  }
})

Given('the active token id of {string} is captured for project {string}', async (tokenName, projectName) => {
  const headers = await getRootHeaders()
  const tokensResponse = await listProjectAccessTokens(projectName, headers)
  const matchingToken = tokensResponse.data.find(t => t.name === tokenName && t.active && !t.revoked)

  if (!matchingToken) {
    throw new Error(`Cannot capture id: no active token named '${tokenName}' for project '${projectName}'`)
  }
  global.savedAccessTokenId = matchingToken.id
})

When('the CI\\/CD variable {string} is replaced as a hidden masked variable for project {string}', async (variableName, projectName) => {
  const headers = await getRootHeaders()
  await deleteProjectVariable(projectName, variableName, headers)
  const createResponse = await createProjectVariable(
    projectName,
    {
      key: variableName,
      value: 'glpat-stale-hidden-value-1234567890', // gitleaks:allow
      masked_and_hidden: true,
      protected: true
    },
    headers
  )
  if (createResponse.status >= 400 || !createResponse.data || !createResponse.data.key) {
    throw new Error(
      `Failed to recreate variable '${variableName}' as hidden (status=${createResponse.status}): ${JSON.stringify(createResponse.data)}`
    )
  }
})

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
  await I.assertVisualMatch(baselineName)
})

Then('the active token id of {string} must differ from the captured id for project {string}', async (tokenName, projectName) => {
  const headers = await getRootHeaders()
  const tokensResponse = await listProjectAccessTokens(projectName, headers)
  const matchingToken = tokensResponse.data.find(t => t.name === tokenName && t.active && !t.revoked)

  if (!matchingToken) {
    throw new Error(`No active token named '${tokenName}' for project '${projectName}'`)
  }
  if (!global.savedAccessTokenId) {
    throw new Error('No captured token id was saved before this assertion')
  }
  if (matchingToken.id === global.savedAccessTokenId) {
    throw new Error(
      `Token id ${matchingToken.id} is unchanged — devsecops:init did not re-rotate the token despite the stale hidden variable`
    )
  }
})

When('I re-run {string} for project {string}', async (command, projectName) => {
  const headers = await getRootHeaders()
  const glabToken = await createLambdaPersonalAccessToken(
    'glab-cli-token-for-rerun',
    ['api', 'write_repository'],
    headers
  )

  const result = runTaskInRepoCaptured(command, '/tmp/test-repo', glabToken, { timeout: 300000 })
  global.lastTaskOutput = result.output
  global.lastTaskExitCode = result.exitCode

  // Retrieve the new token value for clone verification
  const varResponse = await readProjectVariable(projectName, 'TASK_RENOVATE_TOKEN', headers)
  global.renovateTokenForClone = varResponse.data.value
})

Then('the CI\\/CD variable {string} must hold a valid token for project {string}', async (variableName, projectName) => {
  const I = inject().I
  const headers = await getRootHeaders()
  const varResponse = await readProjectVariable(projectName, variableName, headers)
  const tokenValue = varResponse.data.value

  // Verify the token is valid by using it for an authenticated API call
  // GET /api/v4/user requires a valid token and returns the associated user
  const authCheck = await I.sendGetRequest(
    `${BASE_URL}/api/v4/user`,
    { 'PRIVATE-TOKEN': tokenValue }
  )

  if (authCheck.status !== 200) {
    throw new Error(
      `CI/CD variable '${variableName}' holds an invalid token (API returned ${authCheck.status})`
    )
  }
})

Given('a duplicate Renovate token {string} is created for project {string}', async (tokenName, projectName) => {
  const headers = await getRootHeaders()
  await createProjectAccessToken(
    projectName,
    {
      name: tokenName,
      scopes: ['api'],
      access_level: 40,
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    },
    headers
  )
})

Then('only one active token named {string} must exist for {string}', async (tokenName, projectName) => {
  const headers = await getRootHeaders()
  const tokensResponse = await listProjectAccessTokens(projectName, headers)

  const activeTokens = tokensResponse.data.filter(
    t => t.name === tokenName && t.active && !t.revoked
  )

  if (activeTokens.length !== 1) {
    throw new Error(
      `Expected exactly 1 active token named '${tokenName}', found ${activeTokens.length}`
    )
  }
})

Then('I can clone the repository from the GitLab container', async () => {
  // Use the token to git clone the repo
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER

  if (!global.renovateTokenForClone) {
    throw new Error('Renovate token not found for cloning')
  }

  // Use http://${user}:${token}@gitlab...
  // The project name is hardcoded here as 'renovate-token-test' based on the feature file.
  const cloneUrl = `http://renovate:${global.renovateTokenForClone}@gitlab/${lambdaUser}/renovate-token-test.git`

  execSync(`
    rm -rf /tmp/renovate-clone-test || true
    git clone ${cloneUrl} /tmp/renovate-clone-test
  `, { stdio: 'inherit' })
})
