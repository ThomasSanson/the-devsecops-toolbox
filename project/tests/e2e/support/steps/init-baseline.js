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
const {
  BASE_URL,
  projectPath,
  getRootHeaders,
  createLambdaPersonalAccessToken,
  readProjectVariable,
  listProjectAccessTokens
} = require('../helpers/gitlabApi')
const {
  bootstrapWorkspaceRepo,
  runTaskInRepoCaptured
} = require('../helpers/workspaceRepo')
const { freshGet, freshPost } = require('../helpers/http')

const PILOT_REPO_DIR = '/tmp/e2e-init-baseline-repo'

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
  /Creating new Project Access Token .*expires \d{4}-\d{2}-\d{2}/
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
  const glabToken = await createLambdaPersonalAccessToken(
    'glab-cli-token-for-e2e-baseline',
    ['api', 'write_repository'],
    rootHeaders
  )

  // Phase 1 — clone the empty project, copy toolbox source, configure dev env
  // and glab auth. We do NOT run init here: we want the init output captured
  // separately so it can be rendered for visual regression.
  bootstrapWorkspaceRepo(projectName, PILOT_REPO_DIR, glabToken, {
    runInit: false,
    timeout: 300000
  })

  // Phase 2 — run task devsecops:init with captured stdout/stderr.
  const result = runTaskInRepoCaptured(
    'task devsecops:init',
    PILOT_REPO_DIR,
    glabToken,
    { timeout: 300000 }
  )
  global.lastTaskOutput = result.output
  global.lastTaskExitCode = result.exitCode

  if (result.exitCode !== 0) {
    throw new Error(`task devsecops:init failed with exit code ${result.exitCode}`)
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
  // Force a fresh actual capture. Without this, the visual helper reuses any
  // stale `_output/<name>.png` left by a previous run (because captureActual
  // defaults to 'missing'), which silently breaks comparisons after a filter
  // change in the rendered output.
  await I.takeScreenshot(baselineName)
  await I.assertVisualMatch(baselineName)
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
