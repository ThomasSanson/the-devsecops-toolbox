/* global inject Given When Then */
const { GitLabAccessTokenPage } = inject()
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
  revokeProjectAccessToken
} = require('../helpers/gitlabApi')

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
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const rootHeaders = await getRootHeaders()
  const glabToken = await createLambdaPersonalAccessToken(
    'glab-cli-token-for-test',
    ['api', 'write_repository'],
    rootHeaders
  )

  // 4. Clone the test project and copy toolbox source
  execSync(`
    set -e
    export PATH="$HOME/.local/bin:$PATH"

    # Clone the test project
    rm -rf /tmp/test-repo || true
    git clone http://${lambdaUser}:${glabToken}@gitlab/${lambdaUser}/${projectName}.git /tmp/test-repo

    # Copy toolbox source into cloned repo
    cp -r /workspace/. /tmp/test-repo/

    # Configure git user
    cd /tmp/test-repo
    git config user.email "lambda@test.local"
    git config user.name "Lambda"

    # Step 1: Install tools (glab, jq, etc.)
    task dev:setup-environment

    # Step 2: Clean stale glab config and configure like a dev
    rm -rf ~/.config/glab-cli || true
    glab auth login \\
      --hostname gitlab \\
      --token ${glabToken} \\
      --api-protocol http \\
      --api-host gitlab:80 \\
      --git-protocol http

    # Set env vars so glab uses our local instance by default
    export GITLAB_HOST=gitlab
    export GITLAB_TOKEN=${glabToken}

    # Step 3: Configure DevSecOps Framework
    task devsecops:init
  `, { stdio: 'inherit', timeout: 300000 })

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

When('I re-run {string} for project {string}', async (command, projectName) => {
  const headers = await getRootHeaders()
  const glabToken = await createLambdaPersonalAccessToken(
    'glab-cli-token-for-rerun',
    ['api', 'write_repository'],
    headers
  )

  // Re-run from existing /tmp/test-repo
  execSync(`
    set -e
    export PATH="$HOME/.local/bin:$PATH"
    cd /tmp/test-repo
    export GITLAB_HOST=gitlab
    export GITLAB_TOKEN=${glabToken}
    ${command}
  `, { stdio: 'inherit', timeout: 300000 })

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
