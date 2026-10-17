/* global inject Given When Then Before After */
/**
 * Release-crash storyboard — @release-window, on the heavy runner shard.
 *
 * The real thing, not a local `task release`: a GENERATED project gets an actual
 * release pipeline on GitLab's own runner, and the story crashes it twice, for
 * the two ways a failed release can leave damage behind.
 *
 * Chapter 1 — the release opens main's push window for real, then CRASHES
 * mid-push, so the job ends red. A release that dies with main's door open is
 * the exact hole #180 guards. The story shows main locked again anyway, proving
 * the safety net at the level it actually runs: the
 * `trap restore_branch_protection EXIT` inside `task release` and the
 * `after_script: task glab:release:lock-default-branch` (no `|| true`) plus
 * `resource_group: release` in .config/gitlab/ci/devsecops/release.yml.
 *
 * Chapter 2 — the same project releases again, this time with a publish step
 * that cannot work (issue #221: a release once pushed its tag, then died
 * building the image, and main was left naming an image the registry did not
 * have; no retry could get past the tag). The story proves the release pushes
 * NOTHING when it cannot publish: no tag, no version commit. That is the order
 * frozen by `default:` in .config/devsecops/Taskfile.release.yml — bump, then
 * `:project:release`, and only then `push` — and by the 4th invariant of
 * .config/devsecops/scripts/check-release-lock.sh.
 *
 * Chapters 3 and 4 — the version commit and its tag leave in ONE atomic push
 * (issue #296). A third release is queued, a teammate's change lands on the main
 * branch before the job clones, so git rejects the push of the version commit:
 * the story proves the tag stayed behind with it. Then the release is relaunched
 * on the moved main branch, and the story proves it pushes the version commit
 * and its own tag together, and not the tag the project's publish step kept in
 * the job.
 *
 * Chapter 5 — the push token is not left behind (issue #184). The release once
 * wrote its push token into the remote URL of the job's clone and never took
 * it out, so it stayed in .git/config. The test project's release job prints
 * `git remote get-url origin` right after `task release`, and the story proves
 * that address is still the runner's own, without the push token.
 *
 * Both crashes are deterministic, not timing races. Chapter 1 points the
 * release's git server host at a name that does not resolve, so the push fails
 * while the door open and the re-lock (which go through the API URL) both still
 * work. Chapter 2 flips the project's own publish step to a failure (see
 * wirePublishStep). No flaky "cancel the job inside its few-second window" —
 * each job reliably reaches its red cross, and every card is a terminal, stable
 * state.
 *
 * ONE Gherkin sentence = ONE card = ONE pixel baseline (tolerance: 0); every
 * card is a real 1440 px GitLab page (gitlabFrame / jobLogFrame), and each is
 * twinned with a REST/log check of the same fact. Both release jobs are shot
 * the same way, from the same log line, so the two failures read side by side.
 *
 * Runs on a project-scoped runner registered in the shared gitlab-runner compose
 * service, exactly like @daily-contribution (its neighbour on this shard); the
 * runner is torn down surgically so the two stories never disturb each other.
 * See support/helpers/pipelineRunner.js.
 */
const fs = require('fs')
const { I, GitLabProjectPage, GitLabUserPage } = inject()
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
  updateProjectVariable,
  updateProjectSettings,
  putRepositoryFile,
  listProjectBranches,
  listProjectTags,
  listProjectPipelines,
  listPipelineJobs,
  getPipeline,
  cancelPipeline,
  deletePipeline,
  triggerProjectPipeline,
  getJobTrace
} = require('../helpers/gitlabApi')
const { freshGet, freshPost, freshPut, freshDelete } = require('../helpers/http')
const {
  registerScopedRunner,
  teardownScopedRunner,
  dumpFailedTraces,
  PIPELINE_TIMEOUT_MS
} = require('../helpers/pipelineRunner')
const { runTaskInRepo } = require('../helpers/workspaceRepo')
const { renderProject } = require('../helpers/copierRender')
const { stripAnsi } = require('../helpers/capturedOutput')
const { gitlabUrl, gitlabFrame, jobLogFrame, settlePage } = require('../helpers/gitlabCard')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const PROJECT_NAME = 'e2e-release-crash'
// "exit code N" / "exit status N": N is whatever the runner and go-task
// happened to report. It moved from 1 to 201 on a routine gitlab-runner bump,
// and the crashed push has been seen dying on 128 and on 22 with identical
// code. The cards prove what the release did, never which number it died on.
const EXIT_CODE_MASKS = [
  [/exit code \d+/, 'exit code <n>'],
  [/exit status \d+/, 'exit status <n>']
]
// Both release-job cards open on this line: the version exists, and the log
// below it shows what the release did with it.
const RELEASE_CUT = 'Release version cut locally'
// How long lockMainToNoOne keeps racing GitLab's own default-branch
// protection worker. Seconds in practice; the ceiling is only there so a
// genuinely broken API fails loud instead of spinning.
const LOCK_MAIN_TIMEOUT_MS = 30000

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
  // The variable is stored unmasked, so nothing but git itself keeps it out of
  // the job log: the caller checks the log never prints it.
  return tok.data.token
}

// A generated project's `project:release` is an empty placeholder: two echoes.
// Each project fills it with whatever publishes its artifacts — the toolbox's
// own release builds and pushes its devcontainer image there. So give this test
// project a release step that publishes something, and a switch that makes that
// publish fail. Chapter 1 leaves the switch off (the publish is a one-second
// echo, and the release goes on to crash on its push); chapter 2 turns it on,
// which is the incident of issue #221: the image never reaches the registry, and
// the question is whether the tag reached the main branch anyway.
const PUBLISH_FAILS_VAR = 'E2E_PUBLISH_FAILS'
// Chapters 3 and 4 also make the publish step tag its build in the job's clone,
// the way a project's own tooling may: a tag that is the project's business,
// and that the release must not publish along with its own.
const LOCAL_TAG_VAR = 'E2E_PUBLISH_KEEPS_A_TAG'
const RELEASE_PHASE_DONE = '      - cmd: echo "✅ Project Release phase completed successfully"'
// GitLab merges a job's stdout and stderr in arrival order, and two writes on
// different streams a few microseconds apart can land in either order (a 0.5%
// pixel diff on the card, seen twice). So every pair of neighbouring log lines
// either shares a stream or is a process start apart: the progress lines go to
// stdout like the project:release echoes around them, and the failure, written
// by its own process the way a failed docker push would, goes to stderr like
// go-task's "task: Failed to run task" right after it.
const PUBLISH_STEP = `      - cmd: |
          echo "Publishing the image for version $(cat VERSION)..."
          if [ "\${${PUBLISH_FAILS_VAR}:-false}" = "true" ]; then
            sh -c 'echo "ERROR: the image could not be published" >&2'
            exit 1
          fi
          echo "Image published."
          if [ "\${${LOCAL_TAG_VAR}:-false}" = "true" ]; then
            git tag "image-$(cat VERSION)" &&
              echo "Tagged the image build image-$(cat VERSION), a tag for this job only."
          fi
        silent: true
`
function wirePublishStep (repoDir) {
  const file = `${repoDir}/project/Taskfile.yml`
  const content = fs.readFileSync(file, 'utf8')
  if (!content.includes(RELEASE_PHASE_DONE)) {
    throw new Error(`Fixture setup: no project:release placeholder to fill in ${file}`)
  }
  fs.writeFileSync(file, content.replace(RELEASE_PHASE_DONE, `${PUBLISH_STEP}${RELEASE_PHASE_DONE}`))
}

// Chapter 5 reads the remote URL the release leaves in the job's clone: the
// test project's release job prints it once `task release` is done. GitLab
// keeps an included job's keys and takes `script` from the project's own file.
// A failed release stops the script first, so only a release that pushed
// prints it.
const REMOTE_CHECK = 'git remote get-url origin'
function wireRemoteCheck (repoDir) {
  const file = `${repoDir}/.gitlab-ci.yml`
  fs.appendFileSync(file, `\nrelease:\n  script:\n    - task release\n    - ${REMOTE_CHECK}\n`)
}

// Push the freshly rendered framework straight to main as a single `feat:`
// commit: it gives the release a real version to cut, so it actually reaches
// the push (and crashes there). The token-bearing remote URL is swallowed.
function pushFeatToMain (repoDir, token) {
  const user = lambdaUser()
  const remote = `http://${user}:${encodeURIComponent(token)}@gitlab/${user}/${PROJECT_NAME}.git` // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
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
// GitLab protects the default branch ITSELF, from a background worker, a beat
// after the first push to main. A single DELETE+POST races that worker: the
// protection reappears between the two calls and the POST answers 422 "Name has
// already been taken" — on a loaded runner, often enough to redden the shard.
// So retry the pair until main really reads push=0, and let the DELETE speak.
async function lockMainToNoOne (projectName, headers) {
  const enc = encodedProjectPath(projectName)
  const deadline = Date.now() + LOCK_MAIN_TIMEOUT_MS
  let last = { status: 0, data: 'never attempted' }
  while (Date.now() < deadline) {
    const gone = await freshDelete(`${BASE_URL}/api/v4/projects/${enc}/protected_branches/main`, headers)
    if (gone.status >= 400 && gone.status !== 404) {
      last = gone
      await sleep(1000)
      continue
    }
    const res = await freshPost(
      `${BASE_URL}/api/v4/projects/${enc}/protected_branches?name=main&merge_access_level=40&push_access_level=0`,
      {}, headers
    )
    if (res.status < 400) return
    last = res
    await sleep(1000)
  }
  throw new Error(`Failed to lock main to No one (status ${last.status}): ${JSON.stringify(last.data)}`)
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

// The test runner has ONE job slot, and the pipeline's other jobs are ahead of
// the release job in the queue. Each of them pays the whole `task dev:init:ci`
// setup inside nested docker-in-docker: the `plan` job — two echoes of actual
// work — took 43 minutes of it in one run, and the release job sat `pending`
// until the worker was killed for inactivity. This story is about the release
// job, so its siblings are cancelled as soon as they appear. Cancelling needs
// the project owner (lambda): a non-member admin gets 403 here.
async function cancelSiblingJobs (projectName, jobs) {
  const enc = encodedProjectPath(projectName)
  const done = ['success', 'failed', 'canceled', 'canceling', 'skipped']
  for (const job of jobs) {
    if (job.name === 'release' || job.stage === 'release') continue
    if (done.includes(job.status)) continue
    const res = await freshPost(`${BASE_URL}/api/v4/projects/${enc}/jobs/${job.id}/cancel`, {}, lambdaHeaders)
    if (res.status >= 400) {
      console.log(`release-crash: could not cancel job ${job.name} (status ${res.status})`)
    }
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
    if (!release || ['created', 'pending'].includes(release.status)) {
      await cancelSiblingJobs(projectName, jobs)
    }
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

// Settle the pipeline to a terminal state, because the job card shows its
// status beside the log: the release job has already failed, but sibling jobs
// (feedback) may still be mid-run — cancelling them turns their transient state
// into a stable "canceled", and the pipeline stops on a fixed "Failed".
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

// The release job's CI trace as plain text: no colours, no carriage returns,
// no "<iso-timestamp>Z 01O " prefix the runner puts on every line.
async function releaseTrace (jobId, headers) {
  return stripAnsi(await getJobTrace(PROJECT_NAME, jobId, headers))
    .replace(/\r/g, '')
    .split('\n')
    .map(l => l.replace(/^\S+Z \d+[OE]\+? ?/, '').trimEnd())
    .join('\n')
}

// Hold or release this story's runner. A paused runner takes no job, so a
// pipeline triggered meanwhile waits, and whatever changes on GitLab before it
// resumes is already there when its job clones the project.
async function holdRunner (paused, headers) {
  const res = await freshPut(`${BASE_URL}/api/v4/runners/${runner.runnerId}`, { paused }, headers)
  if (res.status >= 400) throw new Error(`Failed to ${paused ? 'pause' : 'resume'} the runner (status ${res.status}): ${JSON.stringify(res.data)}`)
}

// Run one release pipeline on the main branch to its end. The release job must
// end on `status` (`why` says how, for the error). `whileQueued` runs while the
// pipeline waits for a held runner, its other jobs are then cancelled, and only
// then may the runner start. Then the pipeline is settled: the job card shows
// the pipeline's own status beside the log, so its still-running siblings are
// cancelled and it stops on a fixed status. Returns the release job id and its
// trace (printed when the job did not end as expected: the runner truncates a
// long error, and the whole log is what says where the release stopped).
async function runRelease (rootHeaders, why, { status = 'failed', whileQueued = null } = {}) {
  if (whileQueued) await holdRunner(true, rootHeaders)
  const trigger = await triggerProjectPipeline(PROJECT_NAME, 'main', lambdaHeaders)
  if (trigger.status >= 400) throw new Error(`Failed to trigger a release pipeline on main (status ${trigger.status}): ${JSON.stringify(trigger.data)}`)
  const pid = trigger.data.id
  if (whileQueued) {
    await whileQueued()
    await cancelSiblingJobs(PROJECT_NAME, (await listPipelineJobs(PROJECT_NAME, pid, rootHeaders)).data || [])
    await holdRunner(false, rootHeaders)
  }
  const release = await waitReleaseJobTerminal(I, PROJECT_NAME, pid, rootHeaders, runner)
  const trace = await releaseTrace(release.id, rootHeaders)
  if (release.status !== status) {
    console.log(`release-crash: release job log:\n${trace}`)
    throw new Error(`Expected the release job to end ${status} ${why}, got ${release.status}`)
  }
  await cancelPipeline(PROJECT_NAME, pid, lambdaHeaders)
  await waitPipelineTerminal(I, PROJECT_NAME, pid, rootHeaders)
  // Twin of the side panel's "for main": the release ran on the main branch.
  const ref = (await getPipeline(PROJECT_NAME, pid, rootHeaders)).data.ref
  if (ref !== 'main') throw new Error(`Expected the release pipeline to run on main, got ${ref}`)
  return { jobId: release.id, trace }
}

// The release job's page, its log from RELEASE_CUT down to the end of the job.
// A push prints the old and new commit of the branch it moved, abbreviated.
// `fold` closes GitLab's own log sections the card is not about.
function releaseJobCard (frameName, jobId, { fold = [] } = {}) {
  return jobLogFrame(I, frameName, PROJECT_NAME, jobId, {
    from: RELEASE_CUT,
    masks: [...EXIT_CODE_MASKS, [/\b[0-9a-f]{7,}\.\.[0-9a-f]{7,}\b/, '<sha>..<sha>']],
    fold
  })
}

// The main branch as GitLab holds it: its tip commit (id, title, parent_ids).
async function mainTip (headers) {
  const branches = await listProjectBranches(PROJECT_NAME, headers)
  const main = (branches.data || []).find(b => b.name === 'main')
  return (main && main.commit) || {}
}

// A teammate's change lands on the main branch while a release is queued: one
// commit, standing in for a merged merge request. Push access is opened for
// that one commit only, then the main branch is locked again. "[skip ci]" in
// its body: a pipeline of its own on the main branch would cancel the queued
// release as redundant.
const TEAMMATE_COMMIT = 'docs: explain how to contribute'
async function landTeammateChange (rootHeaders) {
  const gone = await freshDelete(`${BASE_URL}/api/v4/projects/${encodedProjectPath(PROJECT_NAME)}/protected_branches/main`, rootHeaders)
  if (gone.status >= 400 && gone.status !== 404) throw new Error(`Failed to open the main branch for the teammate's change (status ${gone.status})`)
  await putRepositoryFile(PROJECT_NAME, 'CONTRIBUTING.md', 'Open a merge request against the main branch.\n', lambdaHeaders,
    { message: `${TEAMMATE_COMMIT}\n\n[skip ci]` })
  await lockMainToNoOne(PROJECT_NAME, rootHeaders)
}

let project = null
let renderDir = null
let tokenId = null
let lambdaHeaders = null
let runner = null
let pushToken = null
let relaunch = null

const ownsScenario = (test) => Boolean(test && test.tags && test.tags.includes('@release-window'))

Before((test) => {
  if (!ownsScenario(test)) return
  project = null
  renderDir = null
  tokenId = null
  lambdaHeaders = null
  runner = null
  pushToken = null
  relaunch = null
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
// Chapter 1 — a real release crashes mid-push, and the push window closes
// ============================================

storyboardStep(Given, 'a release job on the main branch crashes mid-push while it still holds push access, then locks the main branch again on its way out', async () => {
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
  wirePublishStep(renderDir)
  wireRemoteCheck(renderDir)
  pushFeatToMain(renderDir, token)
  // Wire the release automation AND sabotage its push host, so the release opens
  // the door then crashes on the push — deterministically, no timing race.
  pushToken = await wireReleaseAutomation(PROJECT_NAME, rootHeaders)
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
  const { jobId, trace } = await runRelease(rootHeaders, 'on its refused push')

  // Twins, in the order the card reads: the release opened the push window,
  // died on the push itself...
  for (const line of ['Temporarily opening push access for Maintainers', 'Pushing tags and the version commit to main', 'Could not resolve host']) {
    if (!trace.includes(line)) throw new Error(`Expected "${line}" in the crashed release's log, trace:\n${trace}`)
  }
  // ...then re-locked the main branch twice: its own EXIT trap first, then
  // GitLab's after_script. A bare includes() would be satisfied by the trap
  // alone and never prove the after_script ran.
  const afterScript = trace.search(/Running after_script/)
  const RESTORED = 'Default branch protection restored'
  if (afterScript === -1 || trace.indexOf(RESTORED) === -1 || trace.indexOf(RESTORED) > afterScript ||
      trace.indexOf(RESTORED, afterScript) === -1) {
    throw new Error(`Expected the protection restored once by the release itself, then again by the after_script, trace:\n${trace}`)
  }
  // The push token sits in an unmasked variable and in the remote URL the push
  // failed on: the log must not print it.
  if (trace.includes(pushToken)) throw new Error('The crashed release printed its push token in the job log')

  await releaseJobCard('after-script-relock', jobId)
})

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

  // The repository settings, their "Protected branches" section opened the way
  // a reader clicks it, and brought to the top of the card.
  await gitlabFrame(I, 'door-locked-after', gitlabUrl.repoSettings(PROJECT_NAME), {
    waitText: 'Protected branches',
    prepare: async () => {
      await I.executeScript(() => {
        const heading = Array.from(document.querySelectorAll('h2, h3, h4, span')).find(el => el.textContent.trim() === 'Protected branches')
        const section = document.querySelector('#js-protected-branches-settings') ||
          (heading && (heading.closest('section') || heading.closest('div[id*="protected-branches"]')))
        if (!section) throw new Error('No "Protected branches" section on the repository settings page')
        section.setAttribute('data-e2e-protected', '')
        if (section.classList.contains('expanded')) return
        const toggle = section.querySelector('.js-settings-toggle')
        if (toggle) toggle.click()
        else section.classList.add('expanded')
      })
      // The push dropdown of the main branch, drawn and showing its value (a
      // hidden "No one" option of the merge dropdown comes first in the page).
      await I.waitForFunction(() => Array.from(document.querySelectorAll('[data-e2e-protected] button'))
        .some(b => b.offsetParent && b.textContent.trim() === 'No one'), 30)
    },
    scrollTo: async () => {
      await I.executeScript(() => document.querySelector('[data-e2e-protected]').scrollIntoView({ block: 'start' }))
      await settlePage(I, { quietMs: 300 })
    }
  })
})

// ============================================
// Chapter 2 — a release that cannot publish its image pushes nothing
// ============================================

storyboardStep(When, 'the image of a second release cannot be published, so the release job stops before its push', async () => {
  const rootHeaders = await getRootHeaders()
  // Give this release a push that COULD succeed: the real git server host back,
  // so the only thing standing between it and the main branch is its own order
  // of work. That is what makes the next card a proof instead of a coincidence.
  const host = await updateProjectVariable(PROJECT_NAME, 'TASK_DEVSECOPS_RELEASE_GIT_SERVER_HOST', { value: 'gitlab' }, rootHeaders)
  if (host.status >= 400) throw new Error(`Failed to restore the git server host (status ${host.status}): ${JSON.stringify(host.data)}`)
  const fails = await createProjectVariable(PROJECT_NAME, { key: PUBLISH_FAILS_VAR, value: 'true' }, rootHeaders)
  if (fails.status >= 400) throw new Error(`Failed to break the publish step (status ${fails.status}): ${JSON.stringify(fails.data)}`)

  const { jobId, trace } = await runRelease(rootHeaders, 'on its publish step')
  // Twin: the release really died on its publish step...
  if (!trace.includes('the image could not be published')) {
    console.log(`release-crash: second release job log:\n${trace}`)
    throw new Error('Expected the release to fail on the step that publishes its image')
  }
  // ...and it never pushed. A release that pushes its tag before publishing the
  // image leaves that tag behind for a version no image exists for, and no
  // retry can get past it.
  if (trace.includes('Pushing tags')) {
    throw new Error(`The release pushed to the main branch before publishing its image, trace:\n${trace}`)
  }

  await releaseJobCard('publish-failed', jobId)
})

storyboardStep(Then, 'the project has no tag at all, so the main branch never points at a missing image', async () => {
  const rootHeaders = await getRootHeaders()
  // Twin: no tag on the remote, and the main branch still on the single `feat:`
  // commit — the release pushed neither the tag nor its version-bump commit.
  const tags = await listProjectTags(PROJECT_NAME, rootHeaders)
  const names = (tags.data || []).map(t => t.name)
  if (names.length) {
    throw new Error(`Expected the project to carry no tag after a failed image build, got: ${names.join(', ')}`)
  }
  const branches = await listProjectBranches(PROJECT_NAME, rootHeaders)
  const main = (branches.data || []).find(b => b.name === 'main')
  const tip = main && main.commit && main.commit.title
  if (!tip || !tip.startsWith('feat:')) {
    throw new Error(`Expected the main branch to still be on its "feat:" commit, got: ${tip}`)
  }

  await gitlabFrame(I, 'no-tag-without-its-image', gitlabUrl.tags(PROJECT_NAME), {
    waitText: 'Repository has no tags yet',
    height: 640
  })
})

// ============================================
// Chapter 3 — a rejected push publishes nothing
// ============================================

storyboardStep(When, "a teammate's change moves the main branch while a third release waits, so the release job's push is rejected and sends neither the version commit nor its tag", async () => {
  const rootHeaders = await getRootHeaders()
  // The publish step works again, so this release reaches its push, and it
  // keeps a tag of its own in the job, which the push must leave alone.
  const fails = await updateProjectVariable(PROJECT_NAME, PUBLISH_FAILS_VAR, { value: 'false' }, rootHeaders)
  if (fails.status >= 400) throw new Error(`Failed to repair the publish step (status ${fails.status}): ${JSON.stringify(fails.data)}`)
  const tags = await createProjectVariable(PROJECT_NAME, { key: LOCAL_TAG_VAR, value: 'true' }, rootHeaders)
  if (tags.status >= 400) throw new Error(`Failed to make the publish step tag its build (status ${tags.status}): ${JSON.stringify(tags.data)}`)

  const { jobId, trace } = await runRelease(rootHeaders, 'on its rejected push', {
    whileQueued: () => landTeammateChange(rootHeaders)
  })
  // Twins, in the order the card reads: the release cut its version with a
  // local tag beside it, reached its push, and git rejected the main branch...
  for (const line of ['Tagged the image build image-0.2.0', 'Pushing tags and the version commit to main']) {
    if (!trace.includes(line)) throw new Error(`Expected "${line}" in the rejected release's log, trace:\n${trace}`)
  }
  if (!/\[rejected\]\s+HEAD -> main\b/.test(trace)) {
    throw new Error(`Expected git to reject the push of the version commit to the main branch, trace:\n${trace}`)
  }
  // ...and sent no tag on its own: a tag that lands without its version commit
  // names a commit the main branch does not have, and no retry gets past it.
  if (trace.includes('[new tag]')) {
    throw new Error(`The release pushed a tag although its version commit was rejected, trace:\n${trace}`)
  }

  await releaseJobCard('push-rejected', jobId)
})

storyboardStep(Then, 'the project still has no tag after the rejected push', async () => {
  const rootHeaders = await getRootHeaders()
  // Twin: no tag on the remote, and the main branch on the teammate's commit,
  // without the release's version commit on top.
  const names = ((await listProjectTags(PROJECT_NAME, rootHeaders)).data || []).map(t => t.name)
  if (names.length) throw new Error(`Expected no tag after the rejected push, got: ${names.join(', ')}`)
  const tip = await mainTip(rootHeaders)
  if (tip.title !== TEAMMATE_COMMIT) {
    throw new Error(`Expected the main branch to end on the teammate's commit "${TEAMMATE_COMMIT}", got: ${tip.title}`)
  }

  await gitlabFrame(I, 'no-tag-after-rejected-push', gitlabUrl.tags(PROJECT_NAME), {
    waitText: 'Repository has no tags yet',
    height: 640
  })
})

// ============================================
// Chapter 4 — the relaunched release pushes its version commit and its tag together
// ============================================

storyboardStep(When, 'the release is relaunched on the updated main branch and pushes its version commit and its tag together', async () => {
  const rootHeaders = await getRootHeaders()
  relaunch = await runRelease(rootHeaders, 'once relaunched on the updated main branch', { status: 'success' })
  const { jobId, trace } = relaunch
  // Twins: the publish step kept its local tag again, and the push carried the
  // main branch and the release's own tag, and nothing else.
  if (!trace.includes('Tagged the image build image-0.2.0')) {
    throw new Error(`Expected the publish step to tag its build again, trace:\n${trace}`)
  }
  if (!/\s+HEAD -> main\b/.test(trace) || !/\[new tag\]\s+0\.2\.0 -> 0\.2\.0\b/.test(trace)) {
    throw new Error(`Expected the push of the version commit to main and of the tag 0.2.0, trace:\n${trace}`)
  }
  if (/image-0\.2\.0 ->/.test(trace)) {
    throw new Error(`The release pushed the tag its publish step kept for the job, trace:\n${trace}`)
  }

  // Only a passing job saves its cache: that section folds, so the card ends on
  // "Job succeeded" the way the rejected one ends on "Job failed".
  await releaseJobCard('relaunch-pushed', jobId, { fold: ['Saving cache'] })
})

storyboardStep(Then, 'the project has exactly one tag, 0.2.0, on the version commit at the tip of the main branch', async () => {
  const rootHeaders = await getRootHeaders()
  // Twin: one tag, the release's, on the version commit at the tip of the main
  // branch.
  const tags = (await listProjectTags(PROJECT_NAME, rootHeaders)).data || []
  const names = tags.map(t => t.name)
  if (names.join(',') !== '0.2.0') throw new Error(`Expected exactly the tag 0.2.0, got: ${names.join(', ')}`)
  const tip = await mainTip(rootHeaders)
  if (!String(tip.title).startsWith('build: bump version 0.1.0')) {
    throw new Error(`Expected the version commit at the tip of the main branch, got: ${tip.title}`)
  }
  if (tags[0].commit.id !== tip.id) {
    throw new Error(`Expected the tag 0.2.0 on the tip of the main branch ${tip.id}, got ${tags[0].commit.id}`)
  }

  await gitlabFrame(I, 'one-tag-with-its-commit', gitlabUrl.tags(PROJECT_NAME), {
    waitText: '0.2.0',
    height: 640
  })
})

// ============================================
// Chapter 5 — the push token is not left behind
// ============================================

storyboardStep(Then, "the release job's copy of the project still points at GitLab without the push token", async () => {
  // Twin: the line the release job printed after `task release` is the address
  // GitLab's runner cloned with (its own gitlab-ci-token user, whatever GitLab
  // masks), on this project. A release that wrote its push token into the
  // remote URL left its oauth2 user and token there instead.
  const lines = relaunch.trace.split('\n')
  const at = lines.findIndex(l => l.endsWith(`$ ${REMOTE_CHECK}`))
  const remote = at === -1 ? '' : lines[at + 1]
  const runnerRemote = new RegExp(`^http://gitlab-ci-token:[^@]*@gitlab/${lambdaUser()}/${PROJECT_NAME}\\.git$`)
  if (!runnerRemote.test(remote) || remote.includes(pushToken)) {
    throw new Error(`Expected the release to leave the runner's remote URL in the job's clone, got: ${remote.split(pushToken).join('<push token>') || '(no remote printed)'}`)
  }

  await jobLogFrame(I, 'remote-without-push-token', PROJECT_NAME, relaunch.jobId, {
    from: `$ ${REMOTE_CHECK}`,
    fold: ['Saving cache']
  })
})
