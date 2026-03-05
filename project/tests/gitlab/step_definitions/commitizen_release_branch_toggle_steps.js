/* global When Then */
const fs = require('fs')
const {
  BASE_URL,
  getRootHeaders,
  createLambdaPersonalAccessToken,
  readProjectVariable
} = require('../helpers/gitlabApi')
const {
  bootstrapWorkspaceRepo,
  runTaskInRepo
} = require('../helpers/workspaceRepo')

async function runInitAndRelease (projectName, { expectFailure }) {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const repoDir = `/tmp/${projectName}-repo`

  const rootHeaders = await getRootHeaders()
  const glabToken = await createLambdaPersonalAccessToken(
    `glab-cli-token-for-${projectName}`,
    ['api', 'write_repository'],
    rootHeaders
  )
  bootstrapWorkspaceRepo(projectName, repoDir, glabToken, { runInit: true })

  // Local GitLab test environment serves HTTP only.
  // Keep release code HTTPS-based and rewrite transport at git level for E2E.
  runTaskInRepo('git config --local url."http://".insteadOf "https://"', repoDir, glabToken)
  const rewriteRules = runTaskInRepo(
    'git config --local --get-regexp "^url\\." || true',
    repoDir,
    glabToken,
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  const variableResponse = await readProjectVariable(projectName, 'TASK_COMMITIZEN_TOKEN', rootHeaders)
  const commitizenToken = variableResponse.data.value
  if (!commitizenToken) {
    throw new Error(`CI/CD variable TASK_COMMITIZEN_TOKEN is empty for project '${lambdaUser}/${projectName}'`)
  }

  const releaseEnv = {
    TASK_DOCKER_CE_ENABLED: 'false',
    TASK_DEVSECOPS_RELEASE_PUSH_TOKEN: commitizenToken,
    TASK_DEVSECOPS_RELEASE_GITLAB_API_URL: `${BASE_URL}/api/v4`,
    TASK_DEVSECOPS_RELEASE_GIT_SERVER_HOST: expectFailure ? 'invalid-host-for-release' : 'gitlab',
    TASK_DEVSECOPS_RELEASE_PROJECT_PATH: `${lambdaUser}/${projectName}`,
    TASK_DEVSECOPS_RELEASE_CURRENT_BRANCH: 'main',
    TASK_DEVSECOPS_RELEASE_DEFAULT_BRANCH: 'main',
    TASK_DEVSECOPS_RELEASE_ALLOW_PUSH: 'true'
  }

  try {
    const output = runTaskInRepo('task release', repoDir, glabToken, {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 600000,
      extraEnv: releaseEnv
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
