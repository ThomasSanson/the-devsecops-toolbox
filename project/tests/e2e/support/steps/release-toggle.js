/* global inject Given When Then Before */
/**
 * Release-window storyboard — `task release` as ONE continuous journey: main
 * starts locked, a release run opens the push window just long enough to
 * push, then closes it again; the safety net proves the SAME close happens
 * even when the push itself fails (`trap restore_branch_protection EXIT` in
 * Taskfile.release.yml). ONE Gherkin sentence = ONE storyboard card = ONE
 * pixel baseline, asserted inside the step (tolerance: 0); every verdict
 * card twins its GitLab page or <pre> frame with a programmatic REST/log
 * assert of the same fact.
 */
const { I, GitLabProjectPage, GitLabUserPage, GitLabSettingsPage } = inject()
const { execSync } = require('child_process')
const {
  BASE_URL,
  projectPath,
  getRootHeaders,
  createLambdaPersonalAccessToken,
  readProjectVariable
} = require('../helpers/gitlabApi')
const { freshGet } = require('../helpers/http')
const {
  bootstrapWorkspaceRepo,
  runTaskInRepo
} = require('../helpers/workspaceRepo')
const { storyboardStep, addStoryboardFrame, capturePageFrame } = require('../../../../../.config/codeceptjs/storyboard')
const { renderPreFrame, tailFromMarker } = require('../helpers/capturedOutput')

const RELEASE_TIMEOUT = 600000

// The task's own contract lines — everything else (SHAs, push deltas, version
// bumps, remote progress) is volatile and filtered out before a card is
// rendered.
const RELEASE_NOISE_PATTERNS = [
  /^task: \[/,
  /^bump: version /,
  /^bump: commit /,
  /^\s*[0-9a-f]{7,}\.\.[0-9a-f]{7,}\s/,
  /^\s*\* \[new tag\]/,
  /^To https?:\/\/[^\s]+\.git$/,
  /^remote:\s/,
  /^Cloning into /,
  /^(Counting|Compressing|Writing|Total|Resolving) /,
  /^Delta compression /,
  /^husky - /,
  /^sync hooks: /,
  /^\[main [0-9a-f]{7,}\]/,
  /^Date: /,
  /^Author: /,
  /^commit [0-9a-f]{7,}/,
  /Creating new Project Access Token .*expires \d{4}-\d{2}-\d{2}/,
  /Rewrite rules:/
]

const RESTORE_MARKER = '🔒 Restoring branch protection (push=No one)'

function stripAnsi (str) {
  return String(str)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07]*\x07/g, '')
}

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

// Forward slice: the first `after` lines starting at the first line
// containing `marker`.
function headFromMarker (lines, marker, after) {
  const idx = lines.findIndex(line => line.includes(marker))
  if (idx < 0) return lines.slice(0, after)
  return lines.slice(idx, idx + after)
}

function assertContains (raw, expected) {
  if (!raw.includes(expected)) {
    throw new Error(`Expected release logs to contain ${JSON.stringify(expected)}\n---\n${raw}\n---`)
  }
}

async function assertMainProtected (projectName) {
  const headers = await getRootHeaders()
  const encodedPath = encodeURIComponent(projectPath(projectName))
  const res = await freshGet(`${BASE_URL}/api/v4/projects/${encodedPath}/protected_branches/main`, headers)
  const data = res.data || {}
  const mergeLevel = (data.merge_access_levels || []).find(l => l.access_level === 40)
  if (!mergeLevel) {
    throw new Error(`Expected merge_access_levels to contain 40 (Maintainers), got: ${JSON.stringify(data.merge_access_levels)}`)
  }
  const pushLevel = (data.push_access_levels || []).find(l => l.access_level === 0)
  if (!pushLevel) {
    throw new Error(`Expected push_access_levels to contain 0 (No one), got: ${JSON.stringify(data.push_access_levels)}`)
  }
}

async function assertRemoteMainAtSha (projectName, expectedSha) {
  const headers = await getRootHeaders()
  const encodedPath = encodeURIComponent(projectPath(projectName))
  const res = await freshGet(`${BASE_URL}/api/v4/projects/${encodedPath}/repository/branches/main`, headers)
  const remoteSha = res.data && res.data.commit && res.data.commit.id
  if (remoteSha !== expectedSha) {
    throw new Error(`Expected remote main at ${expectedSha}, found ${remoteSha}`)
  }
}

// Bootstraps a project, runs `task devsecops:init` (direct mode: no MR, main
// protected right away) and returns everything the release run needs. The
// lambda browser session is established ONCE by the Given step — GitLab
// redirects an already-authenticated session away from /users/sign_in, so a
// second loginAs (the safety-net project) would hang waiting for the login
// form that never appears.
async function bootstrapLockedProject (projectName) {
  await GitLabProjectPage.deleteProjectIfExists(
    BASE_URL,
    process.env.TASK_GITLAB_ROOT_USER,
    process.env.TASK_GITLAB_ROOT_PASSWORD,
    projectPath(projectName)
  )
  await GitLabProjectPage.createBlankPublicProject(projectName)

  const rootHeaders = await getRootHeaders()
  const { token: glabToken } = await createLambdaPersonalAccessToken(
    `glab-cli-token-for-${projectName}`,
    ['api', 'write_repository'],
    rootHeaders
  )
  const repoDir = `/tmp/${projectName}-repo`
  bootstrapWorkspaceRepo(projectName, repoDir, glabToken, { runInit: true })
  runTaskInRepo('git config --local url."http://".insteadOf "https://"', repoDir, glabToken)
  return { repoDir, glabToken }
}

function runRelease (projectName, repoDir, glabToken, { expectFailure }) {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const releaseEnv = {
    TASK_DOCKER_CE_ENABLED: 'false',
    TASK_DEVSECOPS_RELEASE_PUSH_TOKEN: null, // filled below once TASK_COMMITIZEN_TOKEN is read
    TASK_DEVSECOPS_RELEASE_GITLAB_API_URL: `${BASE_URL}/api/v4`,
    TASK_DEVSECOPS_RELEASE_GIT_SERVER_HOST: expectFailure ? 'invalid-host-for-release' : 'gitlab',
    TASK_DEVSECOPS_RELEASE_PROJECT_PATH: `${lambdaUser}/${projectName}`,
    TASK_DEVSECOPS_RELEASE_CURRENT_BRANCH: 'main',
    TASK_DEVSECOPS_RELEASE_DEFAULT_BRANCH: 'main',
    TASK_DEVSECOPS_RELEASE_ALLOW_PUSH: 'true'
  }
  return async () => {
    const rootHeaders = await getRootHeaders()
    const variableResponse = await readProjectVariable(projectName, 'TASK_COMMITIZEN_TOKEN', rootHeaders)
    releaseEnv.TASK_DEVSECOPS_RELEASE_PUSH_TOKEN = variableResponse.data.value
    try {
      const output = runTaskInRepo('task release', repoDir, glabToken, {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        timeout: RELEASE_TIMEOUT,
        extraEnv: releaseEnv
      })
      return { raw: output || '', failed: false }
    } catch (error) {
      const stdout = error.stdout ? error.stdout.toString() : ''
      const stderr = error.stderr ? error.stderr.toString() : ''
      return { raw: `${stdout}\n${stderr}`, failed: true }
    }
  }
}

let successProject, failureProject
let successRun

Before(() => {
  successProject = null
  failureProject = null
  successRun = null
})

// ============================================
// Given — main starts locked
// ============================================

storyboardStep(Given, 'main starts locked behind push protection', async () => {
  await GitLabUserPage.loginAs(process.env.TASK_GITLAB_LAMBDA_USER, process.env.TASK_GITLAB_LAMBDA_PASSWORD)
  successProject = 'e2e-release-toggle'
  const { repoDir, glabToken } = await bootstrapLockedProject(successProject)
  successProject = { name: successProject, repoDir, glabToken }
  I.resizeWindow(1024, 640)
  await GitLabSettingsPage.gotoProtectedBranchAndMask(projectPath(successProject.name), successProject.name)
  await addStoryboardFrame(I, await capturePageFrame(I, 'protection-locked'))
  I.resizeWindow(1024, 768)
})

// ============================================
// When — the window opens, the push lands
// ============================================

storyboardStep(When, 'a release run opens the push window for maintainers', async () => {
  successRun = await runRelease(successProject.name, successProject.repoDir, successProject.glabToken, { expectFailure: false })()
  if (successRun.failed) {
    throw new Error(`Expected task release to succeed, but it failed:\n${successRun.raw}`)
  }
  assertContains(successRun.raw, 'Temporarily opening push access for Maintainers')
  const filtered = filterReleaseLogs(successRun.raw)
  const slice = headFromMarker(filtered, 'Temporarily opening push access for Maintainers', 3)
  await renderPreFrame(I, 'toggle-opens', slice.join('\n'))
})

storyboardStep(When, 'the release pushes the version bump to main', async () => {
  const subject = execSync(`git -C ${successProject.repoDir} log -1 --format=%s`, { encoding: 'utf8' }).trim()
  const sha = execSync(`git -C ${successProject.repoDir} rev-parse HEAD`, { encoding: 'utf8' }).trim()
  const masked = subject.replace(/\d+\.\d+\.\d+/g, 'x.y.z')
  await renderPreFrame(I, 'push-lands', masked)
  await assertRemoteMainAtSha(successProject.name, sha)
})

// ============================================
// Then — the window closes, both on success and on the safety net
// ============================================

storyboardStep(Then, 'the window closes again and push protection is restored', async () => {
  assertContains(successRun.raw, RESTORE_MARKER)
  const filtered = filterReleaseLogs(successRun.raw)
  const slice = tailFromMarker(filtered, [RESTORE_MARKER], 12)
  await renderPreFrame(I, 'window-closes', slice.join('\n'))
  await assertMainProtected(successProject.name)
})

storyboardStep(Then, 'the safety net still closes the window when the push fails', async () => {
  const failureProjectName = 'e2e-release-toggle-failure'
  const { repoDir, glabToken } = await bootstrapLockedProject(failureProjectName)
  failureProject = { name: failureProjectName, repoDir, glabToken }
  const run = await runRelease(failureProjectName, repoDir, glabToken, { expectFailure: true })()
  if (!run.failed) {
    throw new Error(`Expected task release to fail, but it succeeded:\n${run.raw}`)
  }
  assertContains(run.raw, 'Temporarily opening push access for Maintainers')
  assertContains(run.raw, RESTORE_MARKER)
  const filtered = filterReleaseLogs(run.raw)
  const slice = tailFromMarker(filtered, [RESTORE_MARKER], 12)
  await renderPreFrame(I, 'window-closes-on-failure', slice.join('\n'))
  await assertMainProtected(failureProject.name)
})
