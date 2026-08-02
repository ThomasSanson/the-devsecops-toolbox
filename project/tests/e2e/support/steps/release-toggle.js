/* global inject Given When Then Before After */
/**
 * Release-crash storyboard — @release-window, on the heavy runner shard.
 *
 * The real thing, not a local `task release`: a GENERATED project gets an actual
 * release pipeline on GitLab's own runner, the release job opens main's push
 * window for real, and then it CRASHES mid-push — the push fails, so the job
 * ends red. A release that dies with main's door open is the exact hole #180
 * guards. The story shows main locked again anyway, proving the safety net at
 * the level it actually runs: the `trap restore_branch_protection EXIT` inside
 * `task release` and the `after_script: task glab:release:lock-default-branch`
 * (no `|| true`) plus `resource_group: release` in
 * .config/gitlab/ci/devsecops/release.yml.
 *
 * The crash is deterministic, not a timing race: the push token is granted the
 * `api` scope (enough to open/close the door via the protected-branches API at
 * Maintainer level) but NOT `write_repository`, so the git push is refused (403)
 * while the door open and the re-lock both still work. No flaky "cancel the job
 * inside its few-second window" — the job reliably reaches its red cross, and
 * every card is a terminal, stable state.
 *
 * ONE Gherkin sentence = ONE card = ONE pixel baseline (tolerance: 0); each
 * GitLab page is masked for its volatile chrome, the job-log card is a <pre> of
 * the REAL CI trace, and each is twinned with a REST/log check of the same fact.
 *
 * Runs on a project-scoped runner registered in the shared gitlab-runner compose
 * service, exactly like @daily-contribution (its neighbour on this shard); the
 * runner is torn down surgically so the two stories never disturb each other.
 * See support/helpers/pipelineRunner.js.
 */
const fs = require('fs')
const { I, GitLabProjectPage, GitLabUserPage, GitLabSettingsPage } = inject()
const {
  BASE_URL,
  projectPath,
  encodedProjectPath,
  getRootHeaders,
  createProject,
  deleteProject,
  createLambdaPersonalAccessToken,
  revokePersonalAccessToken,
  createProjectAccessToken,
  createProjectVariable,
  updateProjectSettings,
  listProjectPipelines,
  listPipelineJobs,
  getPipeline,
  cancelPipeline,
  deletePipeline,
  triggerProjectPipeline
} = require('../helpers/gitlabApi')
const { freshGet, freshPost, freshDelete } = require('../helpers/http')
const {
  registerScopedRunner,
  teardownScopedRunner,
  dumpFailedTraces,
  maskPipelinePage,
  PIPELINE_TIMEOUT_MS
} = require('../helpers/pipelineRunner')
const { runTaskInRepo } = require('../helpers/workspaceRepo')
const { runCommandWithResult } = require('../helpers/docker')
const { renderProject } = require('../helpers/copierRender')
const { stripAnsi } = require('../helpers/capturedOutput')
const { storyboardStep, addStoryboardFrame, capturePageFrame } = require('../../../../../.config/codeceptjs/storyboard')

const PROJECT_NAME = 'e2e-release-crash'
// Fixed stand-in for every semver in the job log: the toolbox version and its
// pinned tool versions drift on every bump, so leaving them bare rots the
// baseline. It is display only, so a concrete 1.0.0 reads better than x.y.z.
const DISPLAY_VERSION = '1.0.0'

function lambdaUser () {
  return process.env.TASK_GITLAB_LAMBDA_USER
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Current push access level on main: 40 (Maintainers) while the release holds
// the push window open, 0 (No one) when it is locked, null during the brief
// delete/recreate flip the re-lock does. Reuses caller headers when given.
async function pushAccessLevel (projectName, headers) {
  const h = headers || await getRootHeaders()
  const res = await freshGet(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/protected_branches/main`, h
  )
  const levels = (res.data && res.data.push_access_levels) || []
  if (levels.some(l => l.access_level === 40)) return 40
  if (levels.some(l => l.access_level === 0)) return 0
  return null
}

// main is protected the way the toolbox leaves it at rest: nobody may push
// (push=No one/0), Maintainers may merge (40).
async function assertMainProtected (projectName) {
  const headers = await getRootHeaders()
  const res = await freshGet(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/protected_branches/main`, headers
  )
  const data = res.data || {}
  const pushLevel = (data.push_access_levels || []).find(l => l.access_level === 0)
  if (!pushLevel) {
    throw new Error(`Expected push_access_levels to contain 0 (No one), got: ${JSON.stringify(data.push_access_levels)}`)
  }
  const mergeLevel = (data.merge_access_levels || []).find(l => l.access_level === 40)
  if (!mergeLevel) {
    throw new Error(`Expected merge_access_levels to contain 40 (Maintainers), got: ${JSON.stringify(data.merge_access_levels)}`)
  }
}

function releaseJobOf (jobs) {
  return (jobs || []).find(j => j.name === 'release' || j.stage === 'release')
}

// Wire the release job exactly like `task devsecops:init` — a Maintainer
// TASK_COMMITIZEN_TOKEN it pushes with — PLUS one deliberate sabotage: point its
// git server host at a name that does not resolve. The door open and re-lock go
// through the API URL ($CI_API_V4_URL, untouched) so they still work, but the
// `git push` (which uses the host) fails to resolve — so the release CRASHES
// AFTER opening the window, deterministically, with no timing race. A project
// CI/CD variable overrides the global `variables:` default in variables.yml.
const CRASH_HOST = 'invalid-host-for-release'
async function wireReleaseAutomation (projectName, rootHeaders) {
  const expires = new Date(Date.now() + 300 * 86400000).toISOString().slice(0, 10)
  const tok = await createProjectAccessToken(
    projectName, { name: 'TASK_COMMITIZEN_TOKEN', scopes: ['api', 'write_repository'], access_level: 40, expires_at: expires }, rootHeaders
  )
  if (tok.status >= 400) throw new Error(`Failed to create TASK_COMMITIZEN_TOKEN (status ${tok.status}): ${JSON.stringify(tok.data)}`)
  const v = await createProjectVariable(projectName, { key: 'TASK_COMMITIZEN_TOKEN', value: tok.data.token }, rootHeaders)
  if (v.status >= 400) throw new Error(`Failed to store TASK_COMMITIZEN_TOKEN (status ${v.status}): ${JSON.stringify(v.data)}`)
  const h = await createProjectVariable(projectName, { key: 'TASK_DEVSECOPS_RELEASE_GIT_SERVER_HOST', value: CRASH_HOST }, rootHeaders)
  if (h.status >= 400) throw new Error(`Failed to store the crash host variable (status ${h.status}): ${JSON.stringify(h.data)}`)
}

// Push the freshly rendered framework straight to main as a single `feat:`
// commit: it gives the release a real version to cut, so it actually reaches
// the push (and crashes there). The token-bearing remote URL is swallowed.
function pushFeatToMain (repoDir, token) {
  const user = lambdaUser()
  const remote = `http://${user}:${encodeURIComponent(token)}@gitlab/${user}/${PROJECT_NAME}.git`
  try {
    runTaskInRepo([
      'git init --quiet --initial-branch=main',
      'git config user.email "lambda@test.local"',
      'git config user.name "Lambda"',
      'git config core.hooksPath /dev/null',
      'git config url."http://".insteadOf "https://"',
      'git add -A',
      'git commit --quiet -m "feat: scaffold the project from the devsecops toolbox"',
      `git remote add origin ${remote}`,
      'git push --quiet -u origin main'
    ].join(' && '), repoDir, token, { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (_) {
    throw new Error('Failed to scaffold and push the framework to main (see runner logs)')
  }
}

// Lock main the way `task devsecops:init` leaves it: nobody may push
// (push=No one/0), Maintainers may merge (40). A fresh GitLab project defaults
// its default branch to push=Maintainers(40), so WITHOUT this the release
// "opening the door" (0 -> 40) would be invisible — main would already read 40.
async function lockMainToNoOne (projectName, headers) {
  const enc = encodedProjectPath(projectName)
  try { await freshDelete(`${BASE_URL}/api/v4/projects/${enc}/protected_branches/main`, headers) } catch (_) {}
  const res = await freshPost(
    `${BASE_URL}/api/v4/projects/${enc}/protected_branches?name=main&merge_access_level=40&push_access_level=0`,
    {}, headers
  )
  if (res.status >= 400) throw new Error(`Failed to lock main to No one (status ${res.status}): ${JSON.stringify(res.data)}`)
}

// Wait for the feat push's bootstrap pipeline to actually exist (GitLab creates
// it a beat after the push), then cancel+delete every pipeline. Done BEFORE the
// runner registers so no rival release job is holding the `release`
// resource_group when the run we drive next starts.
async function clearAllPipelines (projectName, headers) {
  const appearBy = Date.now() + 60000
  while (Date.now() < appearBy) {
    const pipes = await listProjectPipelines(projectName, headers)
    if (pipes.data && pipes.data.length) break
    await sleep(2000)
  }
  const pipes = await listProjectPipelines(projectName, headers)
  for (const p of (pipes.data || [])) {
    try {
      await cancelPipeline(projectName, p.id, headers)
      await deletePipeline(projectName, p.id, headers)
    } catch (_) {}
  }
}

// Poll the release job to its terminal state, logging door/status transitions
// so a stuck run is diagnosable. Returns the release job. Fails loud if the
// pipeline ends without a release job at all.
async function waitReleaseJobTerminal (I, projectName, pid, rootHeaders, runner) {
  const deadline = Date.now() + PIPELINE_TIMEOUT_MS
  let last = ''
  while (Date.now() < deadline) {
    const level = await pushAccessLevel(projectName, rootHeaders)
    const jobs = (await listPipelineJobs(projectName, pid, rootHeaders)).data || []
    const release = releaseJobOf(jobs)
    const line = `door=${level} release=${release ? release.status : 'absent'}`
    if (line !== last) { console.log(`release-crash: ${line}`); last = line }
    if (release && ['failed', 'success', 'canceled', 'skipped'].includes(release.status)) {
      if (release.status !== 'failed') dumpFailedTraces(projectName, jobs, rootHeaders, runner && runner.svc)
      return release
    }
    await I.wait(3)
  }
  throw new Error('Release job never reached a terminal state within the pipeline timeout')
}

// Settle the pipeline to a terminal state so the crashed-pipeline card is
// deterministic: the release job has already failed, but sibling jobs (feedback)
// may still be mid-run — cancelling them turns their transient state into a
// stable "canceled", and the whole pipeline stops on a fixed frame.
async function waitPipelineTerminal (I, projectName, pid, headers) {
  const deadline = Date.now() + 120000
  let last = ''
  while (Date.now() < deadline) {
    const pipe = await getPipeline(projectName, pid, headers)
    const status = pipe.data && pipe.data.status
    if (status !== last) { console.log(`release-crash pipeline: ${status}`); last = status }
    if (['failed', 'success', 'canceled', 'skipped'].includes(status)) return status
    await I.wait(2)
  }
  return 'timeout'
}

// Volatile lines that carry a per-run value (install timing, a bump SHA, a
// changelog diff summary) — dropped so the log card is byte-stable at tolerance:0.
const TRACE_NOISE = [
  /^Installed \d+ packages/,
  /^\[detached HEAD [0-9a-f]/,
  /^\s*\d+ files? changed/,
  /^uvx /
]

// Fetch the release job's real CI trace and keep the lines that tell the safety
// net story: the door opening, the failed push, and the restore that ran anyway.
// CI trace lines open with a volatile "<iso-timestamp>Z 01O " prefix — strip it —
// every semver is pinned to a fixed display version so the baseline survives a
// bump, and the per-run noise lines above are dropped.
function releaseTraceStory (projectName, jobId, rootHeaders) {
  const encoded = encodedProjectPath(projectName)
  const raw = runCommandWithResult(
    `curl -s -H 'Authorization: ${rootHeaders.Authorization}' '${BASE_URL}/api/v4/projects/${encoded}/jobs/${jobId}/trace'`
  )
  return stripAnsi(raw.stdout || raw.output || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(l => l.replace(/^\S+Z \d+[OE]\+? ?/, '').trimEnd())
    .map(l => l.replace(/\d+\.\d+\.\d+/g, DISPLAY_VERSION))
    .filter(l => !TRACE_NOISE.some(re => re.test(l.trim())))
}

let project = null
let renderDir = null
let tokenId = null
let lambdaHeaders = null
let runner = null
let pipelineId = null
let releaseJobId = null

const ownsScenario = (test) => Boolean(test && test.tags && test.tags.includes('@release-window'))

Before((test) => {
  if (!ownsScenario(test)) return
  project = null
  renderDir = null
  tokenId = null
  lambdaHeaders = null
  runner = null
  pipelineId = null
  releaseJobId = null
})

After(async (test) => {
  if (!ownsScenario(test)) return
  // Surgical, best-effort: this story's runner token only (never --all-runners),
  // so @daily-contribution, which shares the compose service locally, is untouched.
  if (runner) {
    try { await teardownScopedRunner(runner, await getRootHeaders()) } catch (_) {}
    runner = null
  }
  if (project) {
    try { await deleteProject(project, await getRootHeaders()) } catch (_) {}
    project = null
  }
  if (tokenId) {
    try { await revokePersonalAccessToken(tokenId, await getRootHeaders()) } catch (_) {}
    tokenId = null
  }
  if (renderDir) {
    try { fs.rmSync(renderDir, { recursive: true, force: true }) } catch (_) {}
    renderDir = null
  }
})

// ============================================
// Given — a real release crashes with the door open
// ============================================

storyboardStep(Given, 'a release job crashes on the main branch while it still holds push access', async () => {
  const rootHeaders = await getRootHeaders()
  project = PROJECT_NAME
  await GitLabProjectPage.deleteProjectIfExists(
    BASE_URL,
    process.env.TASK_GITLAB_ROOT_USER,
    process.env.TASK_GITLAB_ROOT_PASSWORD,
    projectPath(PROJECT_NAME)
  )
  const { token, id } = await createLambdaPersonalAccessToken(
    `release-crash-${PROJECT_NAME}`, ['api', 'write_repository'], rootHeaders
  )
  tokenId = id
  // Owner headers: creating/cancelling pipelines on protected main needs merge
  // rights, which the project owner (lambda) has and a non-member admin does not
  // (root gets 400 on trigger, 403 on cancel).
  lambdaHeaders = { 'PRIVATE-TOKEN': token }
  const created = await createProject(
    { name: PROJECT_NAME, visibility: 'public', initialize_with_readme: false },
    { 'PRIVATE-TOKEN': token }
  )
  if (created.status >= 400) {
    throw new Error(`Failed to create project "${PROJECT_NAME}" (status ${created.status}): ${JSON.stringify(created.data)}`)
  }
  renderDir = renderProject()
  pushFeatToMain(renderDir, token)
  // Wire the release automation AND sabotage its push host, so the release opens
  // the door then crashes on the push — deterministically, no timing race.
  await wireReleaseAutomation(PROJECT_NAME, rootHeaders)
  await updateProjectSettings(PROJECT_NAME, { merge_method: 'ff', remove_source_branch_after_merge: true }, rootHeaders)
  // Start from the toolbox's resting state: main locked to No one, so the
  // release's temporary open (0 -> 40) is a real transition and the final
  // re-lock is a real proof.
  await lockMainToNoOne(PROJECT_NAME, rootHeaders)
  // Clear the feat push's bootstrap pipeline BEFORE the runner registers, so no
  // rival release job holds the `release` resource_group.
  await clearAllPipelines(PROJECT_NAME, lambdaHeaders)

  await GitLabUserPage.loginAs(process.env.TASK_GITLAB_LAMBDA_USER, process.env.TASK_GITLAB_LAMBDA_PASSWORD)

  runner = await registerScopedRunner(I, PROJECT_NAME, rootHeaders)
  const trigger = await triggerProjectPipeline(PROJECT_NAME, 'main', lambdaHeaders)
  if (trigger.status >= 400) throw new Error(`Failed to trigger main's pipeline (status ${trigger.status}): ${JSON.stringify(trigger.data)}`)
  pipelineId = trigger.data.id
  const release = await waitReleaseJobTerminal(I, PROJECT_NAME, pipelineId, rootHeaders, runner)
  releaseJobId = release.id

  // Twin: the release job really ran and failed (opened the door, then crashed
  // on the refused push), and its log proves it reached the push window.
  if (release.status !== 'failed') {
    throw new Error(`Expected the release job to fail on its refused push, got ${release.status}`)
  }
  const trace = releaseTraceStory(PROJECT_NAME, releaseJobId, rootHeaders).join('\n')
  if (!trace.includes('Temporarily opening push access for Maintainers')) {
    throw new Error(`Expected the release to have opened the push window before crashing, trace:\n${trace}`)
  }

  // Settle the run before the card: cancel the still-running siblings so the
  // pipeline stops on a fixed frame (release failed, feedback canceled), instead
  // of a per-run mix of in-progress jobs.
  await cancelPipeline(PROJECT_NAME, pipelineId, lambdaHeaders)
  await waitPipelineTerminal(I, PROJECT_NAME, pipelineId, rootHeaders)

  I.resizeWindow(1024, 768)
  await I.amOnPage(`/${projectPath(PROJECT_NAME)}/-/pipelines/${pipelineId}`)
  await maskPipelinePage(I, PROJECT_NAME)
  await addStoryboardFrame(I, await capturePageFrame(I, 'release-crashed'))
})

// ============================================
// When — the safety net runs on the way out
// ============================================

storyboardStep(When, "GitLab's after_script re-locks the main branch even though the release job failed", async () => {
  const rootHeaders = await getRootHeaders()
  const trace = releaseTraceStory(PROJECT_NAME, releaseJobId, rootHeaders).join('\n')
  // Twin: the after_script really ran the lock TASK and restored protection —
  // this is the mechanism (after_script runs on success OR failure).
  if (!trace.includes('Default branch protection restored')) {
    throw new Error(`Expected the after_script lock task to restore protection, trace:\n${trace}`)
  }

  I.resizeWindow(1024, 900)
  await I.amOnPage(`/${projectPath(PROJECT_NAME)}/-/jobs/${releaseJobId}`)
  await I.waitForElement('[data-testid="job-log-content"]', 30)
  await I.wait(4)
  // Collapse GitLab's long job log to just its after_script section and strip the
  // volatile gutter/timestamps, so the card is exactly "the job FAILED, and
  // GitLab still ran `task glab:release:lock-default-branch` from after_script".
  await I.executeScript(() => {
    const lineEls = Array.from(document.querySelectorAll('.js-log-line.job-log-line'))
    const idx = lineEls.findIndex(l => /Running after[ _]script/i.test(l.textContent))
    if (idx > 2) lineEls.slice(0, idx - 3).forEach(l => { l.style.display = 'none' })
    document.querySelectorAll('.job-log-line-number, [class*="log-line-timestamp"], [class*="line-timestamp"]').forEach(e => { e.style.display = 'none' })
    // The last line of any failed job is "ERROR: Job failed: exit code N", and
    // N is whatever the RUNNER decided to report — it moved from 1 to 201 on a
    // routine gitlab-runner bump, with nothing about this story changing. What
    // the card proves is that the after_script re-locked the branch on the way
    // out of a failure, never which number the runner picked for it.
    // Same for the "exit status N" go-task prints above it: the release is
    // crashed on purpose, mid-push, and the number is whichever error the push
    // happened to die on (128 and 22 both seen on identical code).
    document.querySelectorAll('.job-log-line-content').forEach(e => {
      e.textContent = e.textContent
        .replace(/\d+\.\d+\.\d+/g, '1.0.0')
        .replace(/exit code \d+/g, 'exit code <n>')
        .replace(/exit status \d+/g, 'exit status <n>')
    })
  })
  await maskPipelinePage(I, PROJECT_NAME)
  await addStoryboardFrame(I, await capturePageFrame(I, 'after-script-relock'))
  I.resizeWindow(1024, 768)
})

// ============================================
// Then — main is locked again anyway
// ============================================

storyboardStep(Then, 'the main branch is locked again even though the release crashed', async () => {
  // The safety net (the EXIT trap and the after_script re-lock) shut the door on
  // the way out. Wait for it, then prove it on the server and on screen.
  const rootHeaders = await getRootHeaders()
  const deadline = Date.now() + 120000
  let level = null
  while (Date.now() < deadline) {
    level = await pushAccessLevel(PROJECT_NAME, rootHeaders)
    if (level === 0) break
    await sleep(1000)
  }
  if (level !== 0) {
    throw new Error(`main did not re-lock (push=No one) after the crashed release; push level=${level}`)
  }
  await assertMainProtected(PROJECT_NAME)

  I.resizeWindow(1024, 640)
  await GitLabSettingsPage.gotoProtectedBranchAndMask(projectPath(PROJECT_NAME), PROJECT_NAME)
  await addStoryboardFrame(I, await capturePageFrame(I, 'door-locked-after'))
  I.resizeWindow(1024, 768)
})
