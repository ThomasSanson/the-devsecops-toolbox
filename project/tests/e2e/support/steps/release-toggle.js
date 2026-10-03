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
 * Both crashes are deterministic, not timing races. Chapter 1 points the
 * release's git server host at a name that does not resolve, so the push fails
 * while the door open and the re-lock (which go through the API URL) both still
 * work. Chapter 2 flips the project's own publish step to a failure (see
 * wirePublishStep). No flaky "cancel the job inside its few-second window" —
 * each job reliably reaches its red cross, and every card is a terminal, stable
 * state.
 *
 * ONE Gherkin sentence = ONE card = ONE pixel baseline (tolerance: 0); every
 * card is a real GitLab page, masked for its volatile chrome, and each is
 * twinned with a REST/log check of the same fact.
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
  curlAuthFlags,
  getRootHeaders,
  createProject,
  deleteProject,
  createLambdaPersonalAccessToken,
  revokePersonalAccessToken,
  createProjectAccessToken,
  createProjectVariable,
  updateProjectVariable,
  updateProjectSettings,
  listProjectBranches,
  listProjectTags,
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
// Per-run numbers every job log carries, whatever the card shows.
const EXIT_CODE_MASKS = [
  ['exit code \\d+', 'exit code <n>'],
  ['exit status \\d+', 'exit status <n>']
]
// Every semver at once, for a card where none of them carries meaning.
const ALL_SEMVER_MASKS = [['\\d+\\.\\d+\\.\\d+', DISPLAY_VERSION], ...EXIT_CODE_MASKS]
// Same drift, but keeping the release's own 0.1.0 -> 0.2.0 readable on a card
// that is about that very version: only the tool versions the release prints
// (they move with every Renovate bump) are pinned.
const TOOL_SEMVER_MASKS = [
  ['commitizen==\\d+\\.\\d+\\.\\d+', `commitizen==${DISPLAY_VERSION}`],
  ['--python \\d+\\.\\d+', '--python 3.x'],
  // The bump commit's own SHA, and how long uv took to unpack Commitizen.
  ['\\[detached HEAD [0-9a-f]+\\]', '[detached HEAD <sha>]'],
  ['Installed \\d+ packages in [0-9.]+m?s', 'Installed <n> packages in <t>'],
  ...EXIT_CODE_MASKS
]
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
const RELEASE_PHASE_DONE = '      - cmd: echo "✅ Project Release phase completed successfully"'
// Every line goes to STDERR on purpose. GitLab merges a job's stdout and
// stderr in arrival order, and the two streams race: go-task prints its own
// "task: Failed to run task" on stderr, so with the publish lines on stdout
// their position in the log flipped between runs (a 0.5% pixel diff on the
// card, twice in a row). One stream keeps them in write order.
const PUBLISH_STEP = `      - cmd: |
          echo "Publishing the image for version $(cat VERSION)..." >&2
          if [ "\${${PUBLISH_FAILS_VAR}:-false}" = "true" ]; then
            echo "ERROR: the image could not be published" >&2
            exit 1
          fi
          echo "Image published." >&2
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
    `curl -s ${curlAuthFlags(rootHeaders)} '${BASE_URL}/api/v4/projects/${encoded}/jobs/${jobId}/trace'`
  )
  return stripAnsi(raw.stdout || raw.output || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(l => l.replace(/^\S+Z \d+[OE]\+? ?/, '').trimEnd())
    .map(l => l.replace(/\d+\.\d+\.\d+/g, DISPLAY_VERSION))
    .filter(l => !TRACE_NOISE.some(re => re.test(l.trim())))
}

// Open a release job page and turn its log into a card: keep only the part the
// sentence is about (everything above `anchor`, minus `lead` lines of context,
// is hidden) and strip the volatile chrome.
//
// `masks` is the list of [pattern, replacement] pairs applied to every log line.
//
// Volatile, and why each one has to go:
//   - line numbers and timestamps: per-run values in the gutter;
//   - the runner's own cleanup line, which names a container built from a
//     token minted per run: "Possibly zombie container runner-<token>-…-docker-0
//     is disconnected from network …" up to gitlab-runner 19.2, "Container
//     runner-<token>-…-docker-0 disconnected from network …" from 19.3.3 on.
//     Matched on what both wordings share, so the next rewording is caught too;
//   - every semver: the toolbox version and its pinned tools drift on every bump;
//   - "exit code N" / "exit status N": N is whatever the runner and go-task
//     happened to report. It moved from 1 to 201 on a routine gitlab-runner
//     bump, and the crashed push has been seen dying on 128 and on 22 with
//     identical code. What the cards prove is what the release did, never which
//     number it died on.
async function showJobLog (jobId, { anchor, lead, masks }) {
  await I.amOnPage(`/${projectPath(PROJECT_NAME)}/-/jobs/${jobId}`)
  await I.waitForElement('[data-testid="job-log-content"]', 30)
  await I.wait(4)
  await I.executeScript((args) => {
    const lineEls = Array.from(document.querySelectorAll('.js-log-line.job-log-line'))
    const idx = lineEls.findIndex(l => new RegExp(args.anchor, 'i').test(l.textContent))
    if (idx > args.lead) lineEls.slice(0, idx - args.lead).forEach(l => { l.style.display = 'none' })
    document.querySelectorAll('.job-log-line-number, [class*="log-line-timestamp"], [class*="line-timestamp"]').forEach(e => { e.style.display = 'none' })
    const RUNNER_CLEANUP = /runner-\S+.*disconnected from network/i
    lineEls.forEach(l => {
      if (RUNNER_CLEANUP.test(l.textContent)) l.style.display = 'none'
    })
    document.querySelectorAll('.job-log-line-content').forEach(e => {
      e.textContent = args.masks.reduce((text, [pattern, to]) => text.replace(new RegExp(pattern, 'g'), to), e.textContent)
    })
  }, { anchor, lead, masks })
  await maskPipelinePage(I, PROJECT_NAME)
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
  wirePublishStep(renderDir)
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
  // Collapse GitLab's long job log to just its after_script section, so the card
  // is exactly "the job FAILED, and GitLab still ran
  // `task glab:release:lock-default-branch` from after_script".
  await showJobLog(releaseJobId, { anchor: 'Running after[ _]script', lead: 3, masks: ALL_SEMVER_MASKS })
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

// ============================================
// Chapter 2 — a release that cannot build its image pushes nothing
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

  const trigger = await triggerProjectPipeline(PROJECT_NAME, 'main', lambdaHeaders)
  if (trigger.status >= 400) throw new Error(`Failed to trigger the second release pipeline (status ${trigger.status}): ${JSON.stringify(trigger.data)}`)
  pipelineId = trigger.data.id
  const release = await waitReleaseJobTerminal(I, PROJECT_NAME, pipelineId, rootHeaders, runner)
  releaseJobId = release.id
  const trace = releaseTraceStory(PROJECT_NAME, releaseJobId, rootHeaders).join('\n')
  if (release.status !== 'failed') {
    // Printed, not thrown: the runner truncates a long error message, and the
    // whole log is what says WHERE this release stopped.
    console.log(`release-crash: second release job log:\n${trace}`)
    throw new Error(`Expected the second release job to fail on its publish step, got ${release.status}`)
  }
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

  await cancelPipeline(PROJECT_NAME, pipelineId, lambdaHeaders)
  await waitPipelineTerminal(I, PROJECT_NAME, pipelineId, rootHeaders)

  // From the version bump down to the end of the job: the card has to hold the
  // version being cut, the publish failing, and the absence of any push line
  // between them and the after_script.
  I.resizeWindow(1024, 950)
  await showJobLog(releaseJobId, {
    anchor: 'Running Commitizen version bump',
    lead: 1,
    masks: TOOL_SEMVER_MASKS
  })
  await addStoryboardFrame(I, await capturePageFrame(I, 'publish-failed'))
  I.resizeWindow(1024, 768)
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

  I.resizeWindow(1024, 600)
  await I.amOnPage(`/${projectPath(PROJECT_NAME)}/-/tags`)
  await maskPipelinePage(I, PROJECT_NAME)
  await addStoryboardFrame(I, await capturePageFrame(I, 'no-tag-without-its-image'))
  I.resizeWindow(1024, 768)
})
