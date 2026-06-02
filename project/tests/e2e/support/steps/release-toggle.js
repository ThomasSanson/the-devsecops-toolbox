/* global When Then */
/**
 * E2E scenario: `task release` opens push access on a protected branch,
 * then restores "push=No one" — both on success AND on failure. The
 * failure path is the irreplaceable safety net: it proves the trap
 * restores the protection even when the release push fails.
 *
 * Setup: re-uses the same workspaceRepo helper as the pilot. The
 * "branch is protected" assertion is shared with init-baseline.js (see
 * the Then step `the branch ... must be protected with merge for ...`).
 */
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

const RELEASE_TIMEOUT = 600000

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
      timeout: RELEASE_TIMEOUT,
      extraEnv: releaseEnv
    })

    global.releaseLogs = output || ''
    global.releaseFailed = false
    if (expectFailure) {
      throw new Error('Expected task release to fail, but it succeeded')
    }
  } catch (error) {
    const stdout = error.stdout ? error.stdout.toString() : ''
    const stderr = error.stderr ? error.stderr.toString() : ''
    global.releaseLogs = `${stdout}\n${stderr}`
    global.releaseFailed = true

    if (!expectFailure) {
      throw new Error(`task release failed unexpectedly:\n${global.releaseLogs}`)
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

Then('the release logs should contain {string}', (expectedText) => {
  const logs = global.releaseLogs || ''
  if (!logs.includes(expectedText)) {
    throw new Error(
      `Expected release logs to contain ${JSON.stringify(expectedText)}\n` +
      `---\n${logs}\n---`
    )
  }
})

Then('the release command should fail', () => {
  if (!global.releaseFailed) {
    throw new Error('Expected task release to fail, but it succeeded')
  }
})
