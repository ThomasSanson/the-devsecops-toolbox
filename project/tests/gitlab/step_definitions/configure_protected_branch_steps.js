/* global inject When Then */
const { GitLabProtectedBranchPage } = inject()
const { execSync } = require('child_process')
const { freshGet, freshPost } = require('../helpers/http')

// ============================================
// WHEN - Protected branch configuration
// ============================================

When('the branch {string} is protected for {string}', async (branch, projectName) => {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  await GitLabProtectedBranchPage.protectBranchViaApi(
    'http://gitlab:80',
    process.env.TASK_GITLAB_ROOT_USER,
    process.env.TASK_GITLAB_ROOT_PASSWORD,
    `${lambdaUser}/${projectName}`,
    branch
  )
})

When('I run {string} for project {string} with local authentication from workspace source', async (command, projectName) => {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const baseUrl = 'http://gitlab:80'
  const repoDir = '/tmp/protected-branch-init-test-repo'
  const I = inject().I

  // 1. Get root OAuth token to create PAT for lambda user
  const tokenResponse = await I.sendPostRequest(`${baseUrl}/oauth/token`, {
    grant_type: 'password',
    username: process.env.TASK_GITLAB_ROOT_USER,
    password: process.env.TASK_GITLAB_ROOT_PASSWORD
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
      name: 'glab-cli-token-for-protected-branch-init-test',
      scopes: ['api', 'write_repository']
    },
    headers
  )
  const glabToken = patResponse.data.token

  // 4. Clone test project, copy toolbox source, then run command
  execSync(`
    set -e
    export PATH="$HOME/.local/bin:$PATH"

    rm -rf ${repoDir} || true
    git clone http://${lambdaUser}:${glabToken}@gitlab/${lambdaUser}/${projectName}.git ${repoDir}

    cp -r /workspace/. ${repoDir}/

    cd ${repoDir}
    git config user.email "lambda@test.local"
    git config user.name "Lambda"

    task dev:setup-environment

    rm -rf ~/.config/glab-cli || true
    glab auth login \\
      --hostname gitlab \\
      --token ${glabToken} \\
      --api-protocol http \\
      --api-host gitlab:80 \\
      --git-protocol http

    export GITLAB_HOST=gitlab
    export GITLAB_TOKEN=${glabToken}

    ${command}
  `, { stdio: 'inherit', timeout: 300000 })
})

// ============================================
// THEN - Protected branch verification (includes visual regression)
// ============================================

Then('the repository settings show {string} as protected for {string}', async (branch, projectName) => {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  await GitLabProtectedBranchPage.navigateToRepositorySettings(`${lambdaUser}/${projectName}`)
  await GitLabProtectedBranchPage.verifyProtectedBranch(branch)
  await GitLabProtectedBranchPage.verifyVisualRegression()
})

Then('the branch {string} is protected with merge for maintainers and push for no one for {string}', async (branch, projectName) => {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const projectPath = `${lambdaUser}/${projectName}`
  const baseUrl = 'http://gitlab:80'

  const tokenResponse = await freshPost(`${baseUrl}/oauth/token`, {
    grant_type: 'password',
    username: process.env.TASK_GITLAB_ROOT_USER,
    password: process.env.TASK_GITLAB_ROOT_PASSWORD
  })
  const headers = { Authorization: `Bearer ${tokenResponse.data.access_token}` }

  const encodedPath = encodeURIComponent(projectPath)
  const branchResponse = await freshGet(
    `${baseUrl}/api/v4/projects/${encodedPath}/protected_branches/${branch}`, headers
  )
  const data = branchResponse.data

  const mergeLevel = data.merge_access_levels.find(l => l.access_level === 40)
  if (!mergeLevel) {
    throw new Error(
      `Expected merge_access_levels to contain access_level=40 (Maintainers), got: ${JSON.stringify(data.merge_access_levels)}`
    )
  }

  const pushLevel = data.push_access_levels.find(l => l.access_level === 0)
  if (!pushLevel) {
    throw new Error(
      `Expected push_access_levels to contain access_level=0 (No one), got: ${JSON.stringify(data.push_access_levels)}`
    )
  }
})
