/* global inject When Then */
const { GitLabDeployKeyPage } = inject()
const { execSync } = require('child_process')
const { freshGet, freshPost } = require('../helpers/http')

// ============================================
// WHEN - Run deploy key setup via devsecops:init
// ============================================

When('I run the deploy key setup for project {string} with local authentication', async (projectName) => {
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
      name: 'glab-cli-token-for-deploy-key-test',
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
    rm -rf /tmp/deploy-key-test-repo || true
    git clone http://${lambdaUser}:${glabToken}@gitlab/${lambdaUser}/${projectName}.git /tmp/deploy-key-test-repo

    # Copy toolbox source into cloned repo
    cp -r /workspace/. /tmp/deploy-key-test-repo/

    # Configure git user
    cd /tmp/deploy-key-test-repo
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
})

// ============================================
// THEN - Verify deploy key and CI/CD variable
// ============================================

Then('a deploy key {string} must exist with write access for {string}', async (keyTitle, projectName) => {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const projectPath = `${lambdaUser}/${projectName}`
  const baseUrl = 'http://gitlab:80'

  // Verify write access via API using fresh TCP connections
  // (can_push=true is not visible in the UI, and axios pool is stale after execSync)
  const tokenResponse = await freshPost(`${baseUrl}/oauth/token`, {
    grant_type: 'password',
    username: process.env.TASK_GITLAB_ROOT_USER,
    password: process.env.TASK_GITLAB_ROOT_PASSWORD
  })
  const headers = { Authorization: `Bearer ${tokenResponse.data.access_token}` }

  const encodedPath = encodeURIComponent(projectPath)
  const keysResponse = await freshGet(
    `${baseUrl}/api/v4/projects/${encodedPath}/deploy_keys`, headers
  )

  const matchingKey = keysResponse.data.find(k => k.title === keyTitle)
  if (!matchingKey) {
    throw new Error(`Deploy key '${keyTitle}' not found for project '${projectPath}'`)
  }
  if (!matchingKey.can_push) {
    throw new Error(`Deploy key '${keyTitle}' does not have write access (can_push=${matchingKey.can_push})`)
  }

  // Verify key is visible in the UI + visual regression
  await GitLabDeployKeyPage.navigateToRepositorySettings(projectPath)
  await GitLabDeployKeyPage.verifyDeployKey(keyTitle)
  await GitLabDeployKeyPage.verifyVisualRegression()
})

Then('the CI\\/CD variable {string} must exist as file type for {string}', async (variableName, projectName) => {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  await GitLabDeployKeyPage.navigateToCiCdSettings(`${lambdaUser}/${projectName}`)
  await GitLabDeployKeyPage.verifyCiCdVariable(variableName)
  await GitLabDeployKeyPage.verifyVisualRegressionCiCd()
})

// ============================================
// WHEN - Re-run deploy key setup (idempotency / resync)
// ============================================

When('I re-run the deploy key setup for project {string}', async (projectName) => {
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
    { name: 'glab-cli-token-for-deploy-key-rerun', scopes: ['api', 'write_repository'] },
    headers
  )
  const glabToken = patResponse.data.token

  // Re-run from existing /tmp/deploy-key-test-repo
  execSync(`
    set -e
    export PATH="$HOME/.local/bin:$PATH"
    cd /tmp/deploy-key-test-repo
    export GITLAB_HOST=gitlab
    export GITLAB_TOKEN=${glabToken}
    task devsecops:init
  `, { stdio: 'inherit', timeout: 300000 })
})

// ============================================
// WHEN - Tamper deploy key variable
// ============================================

When('the deploy key variable {string} is tampered with for project {string}', async (variableName, projectName) => {
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

  // Replace the CI/CD variable value with an invalid SSH key
  const encodedPath = encodeURIComponent(`${lambdaUser}/${projectName}`)
  await I.sendPutRequest(
    `${baseUrl}/api/v4/projects/${encodedPath}/variables/${variableName}`,
    { value: 'INVALID_SSH_KEY_CONTENT', variable_type: 'file' },
    headers
  )
})

// ============================================
// THEN - Verify deploy key is in sync with variable
// ============================================

Then('the deploy key {string} must be in sync with variable {string} for {string}', async (keyTitle, variableName, projectName) => {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const projectPath = `${lambdaUser}/${projectName}`
  const baseUrl = 'http://gitlab:80'

  // Use fresh TCP connections (avoids socket hang-up after execSync)
  const tokenResponse = await freshPost(`${baseUrl}/oauth/token`, {
    grant_type: 'password',
    username: process.env.TASK_GITLAB_ROOT_USER,
    password: process.env.TASK_GITLAB_ROOT_PASSWORD
  })
  const headers = { Authorization: `Bearer ${tokenResponse.data.access_token}` }

  const encodedPath = encodeURIComponent(projectPath)

  // 1. Get deploy key public key from GitLab
  const keysResponse = await freshGet(
    `${baseUrl}/api/v4/projects/${encodedPath}/deploy_keys`, headers
  )
  const deployKey = keysResponse.data.find(k => k.title === keyTitle)
  if (!deployKey) {
    throw new Error(`Deploy key '${keyTitle}' not found for project '${projectPath}'`)
  }
  if (!deployKey.can_push) {
    throw new Error(`Deploy key '${keyTitle}' does not have write access (can_push=${deployKey.can_push})`)
  }

  // 2. Get private key from CI/CD variable
  const varResponse = await freshGet(
    `${baseUrl}/api/v4/projects/${encodedPath}/variables/${variableName}`, headers
  )
  const privateKey = varResponse.data.value
  if (!privateKey) {
    throw new Error(`CI/CD variable '${variableName}' is empty`)
  }

  // 3. Non-destructive cryptographic verification: extract the public key
  //    embedded in the OpenSSH private key and compare with the registered deploy key.
  //    Pure Node.js — no ssh-keygen needed.

  // Extract raw public key bytes from OpenSSH private key format
  const pemLines = privateKey.split('\n').filter(l => !l.startsWith('-----') && l.trim() !== '')
  const keyBuf = Buffer.from(pemLines.join(''), 'base64')
  const magic = 'openssh-key-v1\0'
  if (keyBuf.toString('ascii', 0, 15) !== magic) {
    throw new Error(`CI/CD variable '${variableName}' does not contain a valid OpenSSH private key`)
  }
  let off = 15
  // Skip cipher name, KDF name, KDF options (3 length-prefixed strings)
  for (let i = 0; i < 3; i++) {
    off += 4 + keyBuf.readUInt32BE(off)
  }
  off += 4 // skip number of keys
  off += 4 // skip public key blob length
  // Inside public key blob: skip key type string, then read raw public key
  off += 4 + keyBuf.readUInt32BE(off) // skip key type
  const pubKeyLen = keyBuf.readUInt32BE(off); off += 4
  const derivedPubKey = keyBuf.subarray(off, off + pubKeyLen)

  // Extract raw public key bytes from registered SSH deploy key
  const registeredBase64 = deployKey.key.split(' ')[1]
  const registeredWire = Buffer.from(registeredBase64, 'base64')
  const regTypeLen = registeredWire.readUInt32BE(0)
  const regKeyLen = registeredWire.readUInt32BE(4 + regTypeLen)
  const registeredPubKey = registeredWire.subarray(4 + regTypeLen + 4, 4 + regTypeLen + 4 + regKeyLen)

  // 4. Compare raw public key bytes
  if (!derivedPubKey.equals(registeredPubKey)) {
    throw new Error(
      'Private key in CI/CD variable does not match the deploy key public key.\n' +
      `  Derived:    ${derivedPubKey.toString('hex')}\n` +
      `  Registered: ${registeredPubKey.toString('hex')}`
    )
  }
})
