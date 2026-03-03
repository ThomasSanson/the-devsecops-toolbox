/* global inject Given When Then */
const { GitLabAccessTokenPage } = inject()
const { execSync } = require('child_process')
const { freshGet } = require('../helpers/http')

// ============================================
// GIVEN - Setup test user and project
// ============================================

Given('a GitLab runs in a container configured with user {string}', async (userName) => {
  const baseUrl = 'http://gitlab:80'
  const rootUser = process.env.TASK_GITLAB_ROOT_USER
  const rootPassword = process.env.TASK_GITLAB_ROOT_PASSWORD
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER

  // Ensure lambda user exists
  const I = inject().I
  const title = await I.grabTitle()
  if (!title) {
    const { GitLabUserPage } = inject()
    await GitLabUserPage.ensureUserViaApi(baseUrl, rootUser, rootPassword, {
      email: process.env.TASK_GITLAB_LAMBDA_EMAIL,
      username: lambdaUser,
      name: 'Lambda User',
      password: process.env.TASK_GITLAB_LAMBDA_PASSWORD
    })
  }
})

Given('a test repository {string} is created in GitLab', async (projectName) => {
  const baseUrl = 'http://gitlab:80'
  const rootUser = process.env.TASK_GITLAB_ROOT_USER
  const rootPassword = process.env.TASK_GITLAB_ROOT_PASSWORD
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER

  const { GitLabProjectPage, GitLabUserPage } = inject()

  // Delete project if exists
  await GitLabProjectPage.deleteProjectIfExists(
    baseUrl, rootUser, rootPassword, `${lambdaUser}/${projectName}`
  )

  // Login as lambda user
  await GitLabUserPage.loginAs(lambdaUser, process.env.TASK_GITLAB_LAMBDA_PASSWORD)

  // Create fresh project
  await GitLabProjectPage.createBlankPublicProject(projectName)
})

// ============================================
// WHEN - Create project access token
// ============================================

When('I run the command {string} for project {string} with local authentication', async (command, projectName) => {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const baseUrl = 'http://gitlab:80'

  const I = inject().I

  // 1. Get root OAuth token to create PAT for lambda user
  const rootUser = process.env.TASK_GITLAB_ROOT_USER
  const rootPassword = process.env.TASK_GITLAB_ROOT_PASSWORD
  const tokenResponse = await I.sendPostRequest(`${baseUrl}/oauth/token`, {
    grant_type: 'password',
    username: rootUser,
    password: rootPassword
  })
  const rootToken = tokenResponse.data.access_token
  const headers = { Authorization: `Bearer ${rootToken}` }

  // 2. Get lambda user ID
  const usersResponse = await I.sendGetRequest(
    `${baseUrl}/api/v4/users?username=${lambdaUser}`, headers
  )
  const lambdaUserId = usersResponse.data[0].id

  // 3. Create a Personal Access Token for glab CLI
  const patResponse = await I.sendPostRequest(
    `${baseUrl}/api/v4/users/${lambdaUserId}/personal_access_tokens`,
    {
      name: 'glab-cli-token-for-test',
      scopes: ['api', 'write_repository']
    },
    headers
  )
  const glabToken = patResponse.data.token

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
  const encodedPath = encodeURIComponent(`${lambdaUser}/${projectName}`)
  const varResponse = await freshGet(
    `${baseUrl}/api/v4/projects/${encodedPath}/variables/TASK_RENOVATE_TOKEN`,
    headers
  )
  global.renovateTokenForClone = varResponse.data.value
})

// ============================================
// THEN - Verify token and CI/CD variables
// ============================================

Then('a Renovate token {string} must exist with Maintainer role for {string}', async (tokenName, projectName) => {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  await GitLabAccessTokenPage.navigateToAccessTokenSettings(`${lambdaUser}/${projectName}`)
  await GitLabAccessTokenPage.verifyTokenWithMaintainerRole(tokenName)
  await GitLabAccessTokenPage.verifyVisualRegression()
})

Then('the token must be present in the project CI\\/CD variables for {string}', async (projectName) => {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  await GitLabAccessTokenPage.navigateToCiCdSettings(`${lambdaUser}/${projectName}`)
  await GitLabAccessTokenPage.verifyCiCdVariable('TASK_RENOVATE_TOKEN')
  await GitLabAccessTokenPage.verifyVisualRegressionCiCd()
})

Given('the CI\\/CD variable {string} value is saved for project {string}', async (variableName, projectName) => {
  const baseUrl = 'http://gitlab:80'
  const rootUser = process.env.TASK_GITLAB_ROOT_USER
  const rootPassword = process.env.TASK_GITLAB_ROOT_PASSWORD
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const I = inject().I

  const tokenResponse = await I.sendPostRequest(`${baseUrl}/oauth/token`, {
    grant_type: 'password',
    username: rootUser,
    password: rootPassword
  })
  const rootToken = tokenResponse.data.access_token
  const headers = { Authorization: `Bearer ${rootToken}` }

  const encodedPath = encodeURIComponent(`${lambdaUser}/${projectName}`)
  const varResponse = await I.sendGetRequest(
    `${baseUrl}/api/v4/projects/${encodedPath}/variables/${variableName}`,
    headers
  )
  global.savedCiVariableValue = varResponse.data.value
})

Then('the CI\\/CD variable {string} must not have changed for project {string}', async (variableName, projectName) => {
  const baseUrl = 'http://gitlab:80'
  const rootUser = process.env.TASK_GITLAB_ROOT_USER
  const rootPassword = process.env.TASK_GITLAB_ROOT_PASSWORD
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const I = inject().I

  const tokenResponse = await I.sendPostRequest(`${baseUrl}/oauth/token`, {
    grant_type: 'password',
    username: rootUser,
    password: rootPassword
  })
  const rootToken = tokenResponse.data.access_token
  const headers = { Authorization: `Bearer ${rootToken}` }

  const encodedPath = encodeURIComponent(`${lambdaUser}/${projectName}`)
  const varResponse = await I.sendGetRequest(
    `${baseUrl}/api/v4/projects/${encodedPath}/variables/${variableName}`,
    headers
  )

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
  const baseUrl = 'http://gitlab:80'
  const rootUser = process.env.TASK_GITLAB_ROOT_USER
  const rootPassword = process.env.TASK_GITLAB_ROOT_PASSWORD
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const I = inject().I

  // Get root OAuth token
  const tokenResponse = await I.sendPostRequest(`${baseUrl}/oauth/token`, {
    grant_type: 'password',
    username: rootUser,
    password: rootPassword
  })
  const rootToken = tokenResponse.data.access_token
  const headers = { Authorization: `Bearer ${rootToken}` }

  // List project access tokens and revoke matching ones
  const encodedPath = encodeURIComponent(`${lambdaUser}/${projectName}`)
  const tokensResponse = await I.sendGetRequest(
    `${baseUrl}/api/v4/projects/${encodedPath}/access_tokens`, headers
  )

  for (const token of tokensResponse.data) {
    if (token.name === tokenName && token.active && !token.revoked) {
      await I.sendDeleteRequest(
        `${baseUrl}/api/v4/projects/${encodedPath}/access_tokens/${token.id}`, headers
      )
    }
  }
})

When('the CI\\/CD variable {string} is tampered with for project {string}', async (variableName, projectName) => {
  const baseUrl = 'http://gitlab:80'
  const rootUser = process.env.TASK_GITLAB_ROOT_USER
  const rootPassword = process.env.TASK_GITLAB_ROOT_PASSWORD
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const I = inject().I

  // Get root OAuth token
  const tokenResponse = await I.sendPostRequest(`${baseUrl}/oauth/token`, {
    grant_type: 'password',
    username: rootUser,
    password: rootPassword
  })
  const rootToken = tokenResponse.data.access_token
  const headers = { Authorization: `Bearer ${rootToken}` }

  // Replace the CI/CD variable value with an invalid token
  const encodedPath = encodeURIComponent(`${lambdaUser}/${projectName}`)
  await I.sendPutRequest(
    `${baseUrl}/api/v4/projects/${encodedPath}/variables/${variableName}`,
    { value: 'glpat-invalid-tampered-value', masked: true }, // gitleaks:allow
    headers
  )
})

When('I re-run {string} for project {string}', async (command, projectName) => {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const baseUrl = 'http://gitlab:80'
  const I = inject().I

  // Get root OAuth token to create a PAT for lambda user
  const rootUser = process.env.TASK_GITLAB_ROOT_USER
  const rootPassword = process.env.TASK_GITLAB_ROOT_PASSWORD
  const tokenResponse = await I.sendPostRequest(`${baseUrl}/oauth/token`, {
    grant_type: 'password',
    username: rootUser,
    password: rootPassword
  })
  const rootToken = tokenResponse.data.access_token
  const headers = { Authorization: `Bearer ${rootToken}` }

  // Get lambda user ID
  const usersResponse = await I.sendGetRequest(
    `${baseUrl}/api/v4/users?username=${lambdaUser}`, headers
  )
  const lambdaUserId = usersResponse.data[0].id

  // Create a fresh PAT for glab CLI
  const patResponse = await I.sendPostRequest(
    `${baseUrl}/api/v4/users/${lambdaUserId}/personal_access_tokens`,
    { name: 'glab-cli-token-for-rerun', scopes: ['api', 'write_repository'] },
    headers
  )
  const glabToken = patResponse.data.token

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
  const encodedPath = encodeURIComponent(`${lambdaUser}/${projectName}`)
  const varResponse = await freshGet(
    `${baseUrl}/api/v4/projects/${encodedPath}/variables/TASK_RENOVATE_TOKEN`,
    headers
  )
  global.renovateTokenForClone = varResponse.data.value
})

Then('the CI\\/CD variable {string} must hold a valid token for project {string}', async (variableName, projectName) => {
  const baseUrl = 'http://gitlab:80'
  const rootUser = process.env.TASK_GITLAB_ROOT_USER
  const rootPassword = process.env.TASK_GITLAB_ROOT_PASSWORD
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const I = inject().I

  // Get root OAuth token to read the CI/CD variable
  const tokenResponse = await I.sendPostRequest(`${baseUrl}/oauth/token`, {
    grant_type: 'password',
    username: rootUser,
    password: rootPassword
  })
  const rootToken = tokenResponse.data.access_token
  const headers = { Authorization: `Bearer ${rootToken}` }

  // Read the CI/CD variable value
  const encodedPath = encodeURIComponent(`${lambdaUser}/${projectName}`)
  const varResponse = await I.sendGetRequest(
    `${baseUrl}/api/v4/projects/${encodedPath}/variables/${variableName}`,
    headers
  )
  const tokenValue = varResponse.data.value

  // Verify the token is valid by using it for an authenticated API call
  // GET /api/v4/user requires a valid token and returns the associated user
  const authCheck = await I.sendGetRequest(
    `${baseUrl}/api/v4/user`,
    { 'PRIVATE-TOKEN': tokenValue }
  )

  if (authCheck.status !== 200) {
    throw new Error(
      `CI/CD variable '${variableName}' holds an invalid token (API returned ${authCheck.status})`
    )
  }
})

Given('a duplicate Renovate token {string} is created for project {string}', async (tokenName, projectName) => {
  const baseUrl = 'http://gitlab:80'
  const rootUser = process.env.TASK_GITLAB_ROOT_USER
  const rootPassword = process.env.TASK_GITLAB_ROOT_PASSWORD
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const I = inject().I

  // Get root OAuth token
  const tokenResponse = await I.sendPostRequest(`${baseUrl}/oauth/token`, {
    grant_type: 'password',
    username: rootUser,
    password: rootPassword
  })
  const rootToken = tokenResponse.data.access_token
  const headers = { Authorization: `Bearer ${rootToken}` }

  // Create a duplicate project access token via API
  const encodedPath = encodeURIComponent(`${lambdaUser}/${projectName}`)
  await I.sendPostRequest(
    `${baseUrl}/api/v4/projects/${encodedPath}/access_tokens`,
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
  const baseUrl = 'http://gitlab:80'
  const rootUser = process.env.TASK_GITLAB_ROOT_USER
  const rootPassword = process.env.TASK_GITLAB_ROOT_PASSWORD
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const I = inject().I

  // Get root OAuth token
  const tokenResponse = await I.sendPostRequest(`${baseUrl}/oauth/token`, {
    grant_type: 'password',
    username: rootUser,
    password: rootPassword
  })
  const rootToken = tokenResponse.data.access_token
  const headers = { Authorization: `Bearer ${rootToken}` }

  // List all project access tokens
  const encodedPath = encodeURIComponent(`${lambdaUser}/${projectName}`)
  const tokensResponse = await I.sendGetRequest(
    `${baseUrl}/api/v4/projects/${encodedPath}/access_tokens`, headers
  )

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
