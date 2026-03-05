/* global inject When Then */
const { execSync } = require('child_process')
const fs = require('fs')
const { freshGet } = require('../helpers/http')

async function getRootHeaders () {
  const I = inject().I
  const baseUrl = 'http://gitlab:80'
  const tokenResponse = await I.sendPostRequest(`${baseUrl}/oauth/token`, {
    grant_type: 'password',
    username: process.env.TASK_GITLAB_ROOT_USER,
    password: process.env.TASK_GITLAB_ROOT_PASSWORD
  })
  return { Authorization: `Bearer ${tokenResponse.data.access_token}` }
}

async function createGlabTokenForLambda (tokenName) {
  const I = inject().I
  const baseUrl = 'http://gitlab:80'
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const headers = await getRootHeaders()

  const usersResponse = await I.sendGetRequest(
    `${baseUrl}/api/v4/users?username=${lambdaUser}`, headers
  )
  const lambdaUserId = usersResponse.data[0].id

  const patResponse = await I.sendPostRequest(
    `${baseUrl}/api/v4/users/${lambdaUserId}/personal_access_tokens`,
    { name: tokenName, scopes: ['api', 'write_repository'] },
    headers
  )
  return patResponse.data.token
}

function prepareWorkspaceRepo (projectName, repoDir, glabToken) {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const cloneToken = encodeURIComponent(glabToken)

  execSync(`
    set -e
    export PATH="$HOME/.local/bin:$PATH"

    rm -rf ${repoDir} || true
    git clone http://${lambdaUser}:${cloneToken}@gitlab/${lambdaUser}/${projectName}.git ${repoDir}

    cp -r /workspace/. ${repoDir}/

    cd ${repoDir}
    git config user.email "lambda@test.local"
    git config user.name "Lambda"

    task dev:setup-environment

    rm -rf ~/.config/glab-cli || true
    glab auth login \\
      --hostname gitlab \\
      --token "$GLAB_TEST_TOKEN" \\
      --api-protocol http \\
      --api-host gitlab:80 \\
      --git-protocol http
  `, {
    env: { ...process.env, GLAB_TEST_TOKEN: glabToken },
    stdio: 'inherit',
    timeout: 600000
  })
}

async function runInitAndRelease (projectName, { expectFailure }) {
  const baseUrl = 'http://gitlab:80'
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const repoDir = `/tmp/${projectName}-repo`

  const glabToken = await createGlabTokenForLambda(`glab-cli-token-for-${projectName}`)
  prepareWorkspaceRepo(projectName, repoDir, glabToken)

  const baseEnv = {
    ...process.env,
    PATH: `${process.env.PATH}:${process.env.HOME}/.local/bin`,
    GITLAB_HOST: 'gitlab',
    GITLAB_TOKEN: glabToken
  }

  execSync('task devsecops:init', {
    cwd: repoDir,
    env: baseEnv,
    stdio: 'inherit',
    timeout: 600000
  })

  // Local GitLab test environment serves HTTP only.
  // Keep release code HTTPS-based and rewrite transport at git level for E2E.
  execSync('git config --local url."http://".insteadOf "https://"', {
    cwd: repoDir,
    env: baseEnv,
    stdio: 'inherit'
  })
  const rewriteRules = execSync('git config --local --get-regexp "^url\\." || true', {
    cwd: repoDir,
    env: baseEnv,
    encoding: 'utf8'
  })

  const headers = await getRootHeaders()
  const encodedPath = encodeURIComponent(`${lambdaUser}/${projectName}`)
  const variableResponse = await freshGet(
    `${baseUrl}/api/v4/projects/${encodedPath}/variables/TASK_COMMITIZEN_TOKEN`,
    headers
  )
  const commitizenToken = variableResponse.data.value
  if (!commitizenToken) {
    throw new Error(`CI/CD variable TASK_COMMITIZEN_TOKEN is empty for project '${lambdaUser}/${projectName}'`)
  }

  const releaseEnv = {
    ...baseEnv,
    TASK_DOCKER_CE_ENABLED: 'false',
    TASK_DEVSECOPS_RELEASE_PUSH_TOKEN: commitizenToken,
    TASK_DEVSECOPS_RELEASE_GITLAB_API_URL: `${baseUrl}/api/v4`,
    TASK_DEVSECOPS_RELEASE_GIT_SERVER_HOST: expectFailure ? 'invalid-host-for-release' : 'gitlab',
    TASK_DEVSECOPS_RELEASE_PROJECT_PATH: `${lambdaUser}/${projectName}`,
    TASK_DEVSECOPS_RELEASE_CURRENT_BRANCH: 'main',
    TASK_DEVSECOPS_RELEASE_DEFAULT_BRANCH: 'main',
    TASK_DEVSECOPS_RELEASE_ALLOW_PUSH: 'true'
  }

  try {
    const output = execSync('task release', {
      cwd: repoDir,
      env: releaseEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 600000
    })

    global.commitizenReleaseLogs = `Rewrite rules:\n${rewriteRules}\n\n${output || ''}`
    global.commitizenReleaseFailed = false
    fs.writeFileSync('/app/project/tests/gitlab/_output/commitizen-release-debug.log', global.commitizenReleaseLogs)
    if (expectFailure) {
      throw new Error('Expected task release to fail, but it succeeded')
    }
  } catch (error) {
    const stdout = error.stdout ? error.stdout.toString() : ''
    const stderr = error.stderr ? error.stderr.toString() : ''
    global.commitizenReleaseLogs = `Rewrite rules:\n${rewriteRules}\n\n${stdout}\n${stderr}`
    global.commitizenReleaseFailed = true
    fs.writeFileSync('/app/project/tests/gitlab/_output/commitizen-release-debug.log', global.commitizenReleaseLogs)

    if (!expectFailure) {
      throw new Error(`task release failed unexpectedly:\n${global.commitizenReleaseLogs}`)
    }
  }
}

When(
  'I run {string} and then {string} for project {string} with local authentication',
  async (initCommand, releaseCommand, projectName) => {
    if (initCommand !== 'task devsecops:init' || releaseCommand !== 'task release') {
      throw new Error(`Unexpected commands: '${initCommand}' and '${releaseCommand}'`)
    }
    await runInitAndRelease(projectName, { expectFailure: false })
  }
)

When(
  'I run {string} and then {string} with a failing push for project {string}',
  async (initCommand, releaseCommand, projectName) => {
    if (initCommand !== 'task devsecops:init' || releaseCommand !== 'task release') {
      throw new Error(`Unexpected commands: '${initCommand}' and '${releaseCommand}'`)
    }
    await runInitAndRelease(projectName, { expectFailure: true })
  }
)

Then('the release logs should contain {string}', async (expectedText) => {
  const logs = global.commitizenReleaseLogs || ''
  if (!logs.includes(expectedText)) {
    throw new Error(`Expected release logs to contain '${expectedText}'`)
  }
})

Then('the release command should fail', async () => {
  if (!global.commitizenReleaseFailed) {
    throw new Error('Expected task release to fail, but it succeeded')
  }
})
