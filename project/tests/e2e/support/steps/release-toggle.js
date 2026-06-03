/* global inject When Then */
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

// ============================================
// Visual proof — rendered into a <pre> block
// ============================================
const { I } = inject()

function stripAnsi (str) {
  return str
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07]*\x07/g, '')
}

// `task release` emits a lot of non-deterministic content (commit SHAs, push
// deltas, version bumps, remote progress). We filter aggressively, then
// anchor the tail on the trap-restore line which is emitted on BOTH success
// and failure paths.
const RELEASE_NOISE_PATTERNS = [
  /^task: \[/,
  /^bump: version /, //                                        e.g. "bump: version 0.1.0 → 0.2.0"
  /^bump: commit /, //                                         "bump: commit and tag created"
  /^\s*[0-9a-f]{7,}\.\.[0-9a-f]{7,}\s/, //                     "abc1234..def5678  HEAD -> main"
  /^\s*\* \[new tag\]/, //                                     " * [new tag]         0.2.0 -> 0.2.0"
  /^To https?:\/\/[^\s]+\.git$/, //                            "To http://gitlab/lambda/...git"
  /^remote:\s/, //                                             "remote: GitLab: ..."
  /^Cloning into /,
  /^(Counting|Compressing|Writing|Total|Resolving) /,
  /^Delta compression /,
  /^husky - /,
  /^sync hooks: /,
  /^\[main [0-9a-f]{7,}\]/, //                                 "[main abc1234] message"
  /^Date: /,
  /^Author: /,
  /^commit [0-9a-f]{7,}/,
  /Creating new Project Access Token .*expires \d{4}-\d{2}-\d{2}/,
  /Rewrite rules:/
]

const RELEASE_TAIL_MARKERS = [
  '🔒 Restoring branch protection (push=No one)'
]
const RELEASE_VISUAL_TAIL_LINES = 20

function filterReleaseLogs (raw) {
  return stripAnsi(raw)
    .replace(/\r/g, '')
    .split('\n')
    .filter(line => {
      const trimmed = line.trim()
      if (trimmed === '') return true
      return !RELEASE_NOISE_PATTERNS.some(re => re.test(trimmed))
    })
}

function tailFromMarker (lines, markers, tail) {
  const markerIdx = lines.reduce((last, line, idx) => {
    return markers.some(m => line.includes(m)) ? idx : last
  }, -1)
  if (markerIdx < 0) return lines.slice(Math.max(0, lines.length - tail))
  const end = markerIdx + 1
  return lines.slice(Math.max(0, end - tail), end)
}

When('the release logs are displayed in the browser', async () => {
  const lines = filterReleaseLogs(global.releaseLogs || '')
  const tail = tailFromMarker(lines, RELEASE_TAIL_MARKERS, RELEASE_VISUAL_TAIL_LINES)
  const output = tail.join('\n')

  await I.usePlaywrightTo('render release logs in browser', async ({ page }) => {
    await page.setContent(
      '<!DOCTYPE html><html><body style="background:#1e1e1e;margin:0;padding:16px">' +
      '<pre id="task-output" style="color:#d4d4d4;font-family:monospace;font-size:14px;line-height:1.4;white-space:pre-wrap;word-break:break-all">' +
      output.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
      '</pre></body></html>'
    )
  })
  await I.wait(0.5)
})

Then('the release logs should visually match {string}', async (baselineName) => {
  await I.takeScreenshot(baselineName)
  await I.assertVisualMatch(baselineName)
})
