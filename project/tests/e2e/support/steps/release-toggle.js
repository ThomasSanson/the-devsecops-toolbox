/* global inject Given When Then Before */
/**
 * Release-window storyboard — `task release` as ONE continuous journey: main
 * starts locked, a release run opens the push window just long enough to
 * push, then closes it again; the safety net proves the SAME close happens
 * even when the push FAILS and even when the job is KILLED mid-window
 * (`trap restore_branch_protection EXIT` in Taskfile.release.yml — go-task
 * drains the EXIT trap on a kill signal, so EXIT alone covers the kill case).
 * ONE Gherkin sentence = ONE storyboard card = ONE pixel baseline, asserted
 * inside the step (tolerance: 0); every verdict card twins its GitLab page or
 * <pre> frame with a programmatic REST/log assert of the same fact.
 */
const { I, GitLabProjectPage, GitLabUserPage, GitLabSettingsPage } = inject()
const { execSync, spawn } = require('child_process')
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
  runTaskInRepo,
  buildGitLabTaskEnv
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

// Fixed stand-in for every semver rendered in a release card. The real toolbox
// version and pinned tool versions drift on every bump; pinning the DISPLAY
// keeps the pixel baselines stable without an abstract x.y.z placeholder.
const RELEASE_DISPLAY_VERSION = '1.0.0'

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
    // Pin every semver to a fixed display version: the toolbox version (bump
    // commit / tag) AND pinned tool versions (commitizen) are volatile, so
    // leaving them bare rots the baselines on the next bump — and bump commits
    // skip CI, so the rot only surfaces on an unrelated MR. It is display only,
    // so a concrete stand-in reads better than an abstract x.y.z.
    .map(line => line.replace(/\d+\.\d+\.\d+/g, RELEASE_DISPLAY_VERSION))
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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Current push access level on main: 40 (Maintainers) while the window is open,
// 0 (No one) when it is closed, null during the brief delete/recreate flip or
// if the branch is momentarily unprotected.
async function pushAccessLevel (projectName) {
  const headers = await getRootHeaders()
  const encodedPath = encodeURIComponent(projectPath(projectName))
  const res = await freshGet(`${BASE_URL}/api/v4/projects/${encodedPath}/protected_branches/main`, headers)
  const levels = (res.data && res.data.push_access_levels) || []
  if (levels.some(l => l.access_level === 40)) return 40
  if (levels.some(l => l.access_level === 0)) return 0
  return null
}

// The release env for the SUCCESS host (gitlab): the window opens for real and
// stays open for the whole run, giving the kill test a wide target.
async function buildReleaseEnv (projectName) {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const rootHeaders = await getRootHeaders()
  const variableResponse = await readProjectVariable(projectName, 'TASK_COMMITIZEN_TOKEN', rootHeaders)
  return {
    TASK_DOCKER_CE_ENABLED: 'false',
    TASK_DEVSECOPS_RELEASE_PUSH_TOKEN: variableResponse.data.value,
    TASK_DEVSECOPS_RELEASE_GITLAB_API_URL: `${BASE_URL}/api/v4`,
    TASK_DEVSECOPS_RELEASE_GIT_SERVER_HOST: 'gitlab',
    TASK_DEVSECOPS_RELEASE_PROJECT_PATH: `${lambdaUser}/${projectName}`,
    TASK_DEVSECOPS_RELEASE_CURRENT_BRANCH: 'main',
    TASK_DEVSECOPS_RELEASE_DEFAULT_BRANCH: 'main',
    TASK_DEVSECOPS_RELEASE_ALLOW_PUSH: 'true'
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

let successProject, failureProject, killedProject
let successRun

Before(() => {
  successProject = null
  failureProject = null
  killedProject = null
  successRun = null
})

// ============================================
// Given — main starts locked
// ============================================

storyboardStep(Given, "main's door is closed to everyone", async () => {
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

storyboardStep(When, 'the release opens the door just long enough to push', async () => {
  successRun = await runRelease(successProject.name, successProject.repoDir, successProject.glabToken, { expectFailure: false })()
  if (successRun.failed) {
    throw new Error(`Expected task release to succeed, but it failed:\n${successRun.raw}`)
  }
  assertContains(successRun.raw, 'Temporarily opening push access for Maintainers')
  const filtered = filterReleaseLogs(successRun.raw)
  const slice = headFromMarker(filtered, 'Temporarily opening push access for Maintainers', 3)
  await renderPreFrame(I, 'toggle-opens', slice.join('\n'))
})

storyboardStep(When, 'it makes its one write to main', async () => {
  const subject = execSync(`git -C ${successProject.repoDir} log -1 --format=%s`, { encoding: 'utf8' }).trim()
  const sha = execSync(`git -C ${successProject.repoDir} rev-parse HEAD`, { encoding: 'utf8' }).trim()
  const masked = subject.replace(/\d+\.\d+\.\d+/g, RELEASE_DISPLAY_VERSION)
  await renderPreFrame(I, 'push-lands', masked)
  await assertRemoteMainAtSha(successProject.name, sha)
})

// ============================================
// Then — the window closes, both on success and on the safety net
// ============================================

storyboardStep(Then, 'it closes the door again the moment it is done', async () => {
  assertContains(successRun.raw, RESTORE_MARKER)
  const filtered = filterReleaseLogs(successRun.raw)
  const slice = tailFromMarker(filtered, [RESTORE_MARKER], 12)
  await renderPreFrame(I, 'window-closes', slice.join('\n'))
  await assertMainProtected(successProject.name)
})

storyboardStep(Then, 'a crash still cannot leave the door open', async () => {
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

storyboardStep(Then, 'a killed job still cannot leave the door open', async () => {
  const killedName = 'e2e-release-toggle-killed'
  const { repoDir, glabToken } = await bootstrapLockedProject(killedName)
  killedProject = { name: killedName, repoDir, glabToken }
  const releaseEnv = await buildReleaseEnv(killedName)

  // detached: true → the child leads its own process group, so a negative-pid
  // signal reaches BOTH go-task and the bash child carrying the trap. The trap
  // then fires whether or not go-task forwards the signal itself.
  const child = spawn('task', ['release'], {
    cwd: repoDir,
    env: { ...buildGitLabTaskEnv(glabToken), ...releaseEnv },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (!child.pid) throw new Error('Failed to spawn `task release`')
  let out = ''
  child.stdout.on('data', d => { out += d.toString() })
  child.stderr.on('data', d => { out += d.toString() })
  const exited = new Promise(resolve => child.on('close', resolve))

  // Kill ONLY once the window is provably open (push=Maintainers via REST),
  // never on a timer — the window stays open for the whole release, so a tight
  // poll always catches it well before the run could finish on its own.
  const deadline = Date.now() + 120000
  let opened = false
  while (Date.now() < deadline) {
    if (await pushAccessLevel(killedName) === 40) { opened = true; break }
    await sleep(150)
  }
  if (!opened) {
    try { process.kill(-child.pid, 'SIGKILL') } catch (e) { /* already gone */ }
    await exited
    throw new Error(`Release never opened the push window within 120s:\n${out}`)
  }

  // SIGTERM the group — the exact signal a cancelled or timed-out CI job gets.
  process.kill(-child.pid, 'SIGTERM')
  await exited

  // The trap ran on the signal: the window opened, then the restore marker
  // printed on the way out, and main is protected again on the server.
  assertContains(out, 'Temporarily opening push access for Maintainers')
  assertContains(out, RESTORE_MARKER)
  await assertMainProtected(killedProject.name)

  // The result a human must SEE: GitLab's protected-branches page shows main
  // locked again ("Allowed to push: No one") AFTER the killed release.
  I.resizeWindow(1024, 640)
  await GitLabSettingsPage.gotoProtectedBranchAndMask(projectPath(killedProject.name), killedProject.name)
  await addStoryboardFrame(I, await capturePageFrame(I, 'protection-relocked-after-kill'))
  I.resizeWindow(1024, 768)
})
