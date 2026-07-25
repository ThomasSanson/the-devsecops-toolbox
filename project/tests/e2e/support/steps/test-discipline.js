/* global inject Given When Then Before After NodeFilter MutationObserver */
/**
 * Storyboard-coverage gate DOGFOOD — @test-discipline, on the heavy runner shard.
 *
 * The gate (.config/devsecops/scripts/check-storyboard-coverage.sh, wired as the
 * `storyboard-coverage` job in .config/gitlab/ci/devsecops/test.yml) fails a
 * merge request when product files changed with NO storyboard card changed or
 * added. The gate itself touches .config/**, so by its own rule it owes a
 * visible proof — this is it.
 *
 * The proof is the product, not a reconstruction: the framework working tree is
 * pushed to the in-repo test GitLab, a REAL merge request changes a REAL
 * framework file with no card, and the REAL job stops it. Then the card is
 * pushed to the same merge request and the same job goes green. Every card is a
 * real GitLab page (merge request, job log), twinned with a REST check of the
 * same fact.
 *
 * The job is framework-only (the generated `test.yml.jinja` twin carries no such
 * job), so the fixture is the toolbox tree itself — not a copier render.
 *
 * Economy, not fabrication: a framework merge-request pipeline holds 26 jobs
 * (9 e2e shards among them). Every job but `storyboard-coverage` is cancelled
 * BEFORE the runner is registered, so the single job slot only ever runs the
 * gate. The gate's verdict, its log and its exit code are entirely real.
 *
 * Runs on the shard that owns the shared gitlab-runner compose service; the
 * runner is torn down surgically so the neighbouring stories are untouched.
 */
const fs = require('fs')
const { execSync } = require('child_process')
const { I, GitLabProjectPage, GitLabUserPage, GitLabMergeRequestPage } = inject()
const {
  BASE_URL,
  projectPath,
  encodedProjectPath,
  getRootHeaders,
  createProject,
  deleteProject,
  createLambdaPersonalAccessToken,
  revokePersonalAccessToken,
  createMergeRequest,
  updateProjectSettings,
  listProjectPipelines,
  listPipelineJobs,
  getPipeline,
  cancelPipeline,
  deletePipeline
} = require('../helpers/gitlabApi')
const { freshGet, freshPost } = require('../helpers/http')
const {
  registerScopedRunner,
  teardownScopedRunner,
  maskPipelinePage,
  PIPELINE_TIMEOUT_MS
} = require('../helpers/pipelineRunner')
const { storyboardStep, addStoryboardFrame, capturePageFrame } = require('../../../../../.config/codeceptjs/storyboard')

const PROJECT_NAME = 'e2e-storyboard-gate'
const GATE_JOB = 'storyboard-coverage'
const BRANCH = 'ci-release-cleanup-note'
// The framework tree lives in /workspace inside the codeceptjs container (the
// working branch, tarred in without .git — see project/Taskfile.yml).
const FRAMEWORK_SRC = '/workspace'
const FIXTURE_DIR = '/tmp/e2e-storyboard-gate-repo'
// A REAL framework file changed by the merge request, and the REAL card that
// covers it: the crashed-release story is exactly the proof a change to the
// release job's CI definition owes.
const PRODUCT_FILE = '.config/gitlab/ci/devsecops/release.yml'
const CARD_FILE = 'project/tests/e2e/features/02-daily-work/release-window.feature'

function lambdaUser () {
  return process.env.TASK_GITLAB_LAMBDA_USER
}

function sh (cmd, cwd) {
  return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000, encoding: 'utf8' }).trimEnd()
}

// Cancel every job of the merge-request pipeline EXCEPT the gate. Called before
// the runner exists, so nothing has started and nothing is interrupted.
async function cancelSiblingJobs (projectName, pid, headers) {
  const jobs = (await listPipelineJobs(projectName, pid, headers)).data || []
  let kept = 0
  for (const job of jobs) {
    if (job.name === GATE_JOB) { kept += 1; continue }
    if (['success', 'failed', 'canceled', 'skipped'].includes(job.status)) continue
    await freshPost(
      `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/jobs/${job.id}/cancel`, {}, headers
    )
  }
  if (!kept) throw new Error(`The merge-request pipeline has no "${GATE_JOB}" job (${jobs.length} jobs)`)
  return jobs.length
}

// The merge request's own pipeline (merge_request_event), as soon as GitLab
// created it for the push.
async function waitMrPipelineId (projectName, mrIid, headers, afterId = 0) {
  const deadline = Date.now() + 180000
  while (Date.now() < deadline) {
    const res = await freshGet(
      `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/merge_requests/${mrIid}/pipelines`, headers
    )
    const fresh = ((res.data) || []).filter(p => p.id > afterId)
    if (fresh.length) return fresh[0].id
    await I.wait(3)
  }
  throw new Error(`No merge-request pipeline appeared for !${mrIid}`)
}

// Poll the gate job to a terminal state, cancelling any sibling the runner may
// have grabbed meanwhile (the second push races the already-registered runner).
async function waitGateJob (projectName, pid, headers) {
  const deadline = Date.now() + PIPELINE_TIMEOUT_MS
  let last = ''
  while (Date.now() < deadline) {
    const jobs = (await listPipelineJobs(projectName, pid, headers)).data || []
    const gate = jobs.find(j => j.name === GATE_JOB)
    if (gate && gate.status !== last) { console.log(`${GATE_JOB} #${gate.id}: ${gate.status}`); last = gate.status }
    for (const job of jobs) {
      if (job.name === GATE_JOB) continue
      if (['success', 'failed', 'canceled', 'skipped'].includes(job.status)) continue
      await freshPost(
        `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/jobs/${job.id}/cancel`, {}, headers
      )
    }
    if (gate && ['success', 'failed', 'canceled'].includes(gate.status)) return gate
    await I.wait(5)
  }
  throw new Error(`The ${GATE_JOB} job never finished on pipeline ${pid}`)
}

async function waitPipelineTerminal (projectName, pid, headers) {
  const deadline = Date.now() + 300000
  let last = ''
  while (Date.now() < deadline) {
    const pipe = await getPipeline(projectName, pid, headers)
    const status = pipe.data && pipe.data.status
    if (status !== last) { console.log(`gate pipeline ${pid}: ${status}`); last = status }
    if (['success', 'failed', 'canceled', 'skipped'].includes(status)) return status
    await I.wait(5)
  }
  return 'timeout'
}

// The job page, stripped of everything that moves between runs: the log gutter
// and timestamps, and the commit SHA the gate prints in its header line. Text
// nodes only — replacing textContent would flatten the log's real colours.
async function captureGateJobFrame (jobId, frameName) {
  // Tall enough for the job header and the whole collapsed log, short enough to
  // leave no dead white space under it.
  I.resizeWindow(1024, 560)
  await I.amOnPage(`/${projectPath(PROJECT_NAME)}/-/jobs/${jobId}`)
  await I.waitForElement('[data-testid="job-log-content"]', 60)
  await I.waitForText('Storyboard-coverage gate', 60)
  await maskPipelinePage(I, PROJECT_NAME)
  await I.executeScript(() => {
    // Collapse the log to the gate's own run, the way a reader clicks past the
    // runner's boilerplate: everything before the command line goes (cache
    // restore, image pull — and with them the toolbox version and image digest,
    // which move on every release).
    const lines = Array.from(document.querySelectorAll('.js-log-line.job-log-line'))
    const start = lines.findIndex(l => /check-storyboard-coverage\.sh/.test(l.textContent))
    if (start > 0) lines.slice(0, start).forEach(l => { l.style.display = 'none' })
    document.querySelectorAll(
      '.job-log-line-number, [class*="log-line-timestamp"], [class*="line-timestamp"]'
    ).forEach(el => { el.style.display = 'none' })
    const log = document.querySelector('[data-testid="job-log-content"]')
    if (!log) return
    const walker = document.createTreeWalker(log, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    nodes.forEach(n => {
      const v = n.nodeValue.replace(/\b[0-9a-f]{8,}\b/g, '<sha>')
      if (v !== n.nodeValue) n.nodeValue = v
    })
    // Back to the top so the card carries the job's own header: its name and
    // its red or green status, not just the log body.
    window.scrollTo(0, 0)
  })
  await I.wait(1)
  await addStoryboardFrame(I, await capturePageFrame(I, frameName))
  I.resizeWindow(1024, 768)
}

// GitLab recomputes a merge request's diff asynchronously after a push, so the
// Changes tab can still show the previous version for a few seconds. Wait for
// the API to report the files before opening the page — the alternative, a
// longer waitForText, hides the race instead of ending it.
async function waitMrChanges (headers, mustInclude) {
  const deadline = Date.now() + 180000
  let paths = []
  while (Date.now() < deadline) {
    const res = await freshGet(
      `${BASE_URL}/api/v4/projects/${encodedProjectPath(PROJECT_NAME)}/merge_requests/${global.gateMrIid}/changes`,
      headers
    )
    paths = ((res.data && res.data.changes) || []).map(c => c.new_path)
    if (mustInclude.every(p => paths.includes(p))) return paths
    await I.wait(5)
  }
  throw new Error(`The merge request diff never included ${mustInclude.join(', ')}; got ${JSON.stringify(paths)}`)
}

// Everything the gate itself printed: the trace from the guard's command line
// on. Only useful when something went wrong, so it stays out of the cards.
function gateSection (trace) {
  const marker = trace.indexOf('check-storyboard-coverage.sh')
  const from = marker === -1 ? Math.max(0, trace.length - 4000) : marker
  return trace.slice(from).split('\n').slice(0, 60)
    .map(l => l.replace(/^\S+Z \d+[OE]\+? ?/, ''))
    .join('\n')
}

function jobTrace (jobId, headers) {
  const auth = headers.Authorization
    ? `-H 'Authorization: ${headers.Authorization}'`
    : `-H 'PRIVATE-TOKEN: ${headers['PRIVATE-TOKEN']}'`
  return sh(
    `curl -s ${auth} '${BASE_URL}/api/v4/projects/${encodedProjectPath(PROJECT_NAME)}/jobs/${jobId}/trace'`,
    '/tmp'
  )
}

const ownsScenario = (test) => Boolean(test && test.tags && test.tags.includes('@test-discipline'))

Before((test) => {
  if (!ownsScenario(test)) return
  global.gateProject = null
  global.gateToken = null
  global.gateTokenId = null
  global.gateMrIid = null
  global.gateRunner = null
  global.gateRedJobId = null
  global.gateFirstPid = null
})

After(async (test) => {
  if (!ownsScenario(test)) return
  if (global.gateRunner) {
    try {
      const rootHeaders = await getRootHeaders()
      await teardownScopedRunner(global.gateRunner, rootHeaders)
    } catch (_) {}
    global.gateRunner = null
  }
  if (global.gateProject) {
    try {
      const rootHeaders = await getRootHeaders()
      await deleteProject(global.gateProject, rootHeaders)
    } catch (_) {}
    global.gateProject = null
  }
  if (global.gateTokenId) {
    try {
      const rootHeaders = await getRootHeaders()
      await revokePersonalAccessToken(global.gateTokenId, rootHeaders)
    } catch (_) {}
    global.gateTokenId = null
  }
  try { fs.rmSync(FIXTURE_DIR, { recursive: true, force: true }) } catch (_) {}
})

// The whole off-camera stage in one sentence, closed by its visual proof: the
// framework tree on its own GitLab project, and a merge request holding exactly
// one framework file and no card at all.
storyboardStep(Given, 'the merge request changes one framework file and brings no proof card', async () => {
  const rootHeaders = await getRootHeaders()
  global.gateProject = PROJECT_NAME
  await GitLabProjectPage.deleteProjectIfExists(
    BASE_URL,
    process.env.TASK_GITLAB_ROOT_USER,
    process.env.TASK_GITLAB_ROOT_PASSWORD,
    projectPath(PROJECT_NAME)
  )
  const { token, id } = await createLambdaPersonalAccessToken(
    `gate-${PROJECT_NAME}`, ['api', 'write_repository'], rootHeaders
  )
  global.gateToken = token
  global.gateTokenId = id
  const created = await createProject(
    { name: PROJECT_NAME, visibility: 'public', initialize_with_readme: false },
    { 'PRIVATE-TOKEN': token }
  )
  if (created.status >= 400) {
    throw new Error(`Failed to create project "${PROJECT_NAME}" (status ${created.status}): ${JSON.stringify(created.data)}`)
  }
  // A merge request may only merge on a green pipeline — the setting the toolbox
  // applies through TASK_GLAB_PIPELINE_MUST_SUCCEED. It is what turns the gate's
  // red cross into a blocked merge.
  await updateProjectSettings(
    PROJECT_NAME, { only_allow_merge_if_pipeline_succeeds: true, merge_method: 'ff' }, rootHeaders
  )

  // The framework tree itself is the fixture (the gate job is framework-only).
  const user = lambdaUser()
  const remote = `http://${user}:${encodeURIComponent(token)}@gitlab/${user}/${PROJECT_NAME}.git`
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true })
  // chown: the tar-extracted /workspace keeps the HOST uid, and git refuses to
  // work in a repository owned by another user (dubious ownership).
  sh(`mkdir -p ${FIXTURE_DIR} && cp -a ${FRAMEWORK_SRC}/. ${FIXTURE_DIR} && chown -R "$(id -u):$(id -g)" ${FIXTURE_DIR}`, '/tmp')
  sh([
    'git init --quiet --initial-branch=main',
    'git config user.email "lambda@test.local"',
    'git config user.name "Lambda"',
    'git config core.hooksPath /dev/null',
    'git add -A',
    'git commit --quiet -m "chore: the toolbox as it stands on the main branch"',
    `git remote add origin ${remote}`,
    'git push --quiet -u origin main 2>/dev/null'
  ].join(' && '), FIXTURE_DIR)

  // The merge request: ONE framework file changed, no storyboard file at all.
  fs.appendFileSync(
    `${FIXTURE_DIR}/${PRODUCT_FILE}`,
    '\n# The cleanup above runs whatever the release job does, pass or fail.\n'
  )
  sh([
    `git checkout --quiet -b ${BRANCH}`,
    `git add ${PRODUCT_FILE}`,
    'git commit --quiet -m "ci(release): say why the cleanup runs on every outcome"',
    `git push --quiet -u origin ${BRANCH} 2>/dev/null`
  ].join(' && '), FIXTURE_DIR)

  const lambdaHeaders = { 'PRIVATE-TOKEN': token }
  const mr = await createMergeRequest(
    PROJECT_NAME,
    {
      source_branch: BRANCH,
      target_branch: 'main',
      title: 'ci(release): say why the cleanup runs on every outcome',
      description: 'One comment line above the after_script, so the next reader knows the cleanup is not optional.',
      remove_source_branch: true
    },
    lambdaHeaders
  )
  if (mr.status >= 400) throw new Error(`Failed to open the merge request (status ${mr.status}): ${JSON.stringify(mr.data)}`)
  global.gateMrIid = mr.data.iid

  // Twin FIRST: the merge request really holds product and no storyboard file.
  const paths = await waitMrChanges(rootHeaders, [PRODUCT_FILE])
  if (paths.length !== 1) {
    throw new Error(`Expected only ${PRODUCT_FILE} in the merge request, got ${JSON.stringify(paths)}`)
  }

  // The Changes tab, as its reviewer opens it: one framework file, nothing else.
  await GitLabUserPage.loginAs(process.env.TASK_GITLAB_LAMBDA_USER, process.env.TASK_GITLAB_LAMBDA_PASSWORD)
  I.resizeWindow(1024, 640)
  await GitLabMergeRequestPage.gotoChangesAndMask(
    projectPath(PROJECT_NAME), global.gateMrIid, PROJECT_NAME, PRODUCT_FILE
  )
  await addStoryboardFrame(I, await capturePageFrame(I, 'changes-without-card'))
  I.resizeWindow(1024, 768)

  // Cancel every job but the gate BEFORE any runner exists, then give the
  // pipeline its single job slot.
  const pid = await waitMrPipelineId(PROJECT_NAME, global.gateMrIid, rootHeaders)
  global.gateFirstPid = pid
  const total = await cancelSiblingJobs(PROJECT_NAME, pid, rootHeaders)
  console.log(`gate pipeline ${pid}: kept ${GATE_JOB}, cancelled ${total - 1} sibling jobs`)
  // The push to main spawned its own pipeline; delete it so it never competes
  // for the slot.
  try {
    const pipes = await listProjectPipelines(PROJECT_NAME, rootHeaders)
    for (const p of (pipes.data || [])) {
      if (p.id === pid) continue
      await cancelPipeline(PROJECT_NAME, p.id, rootHeaders)
      await deletePipeline(PROJECT_NAME, p.id, rootHeaders)
    }
  } catch (_) {}
  global.gateRunner = await registerScopedRunner(I, PROJECT_NAME, rootHeaders)
})

storyboardStep(Then, 'GitLab refuses to merge it, one check failed', async () => {
  const rootHeaders = await getRootHeaders()
  const gate = await waitGateJob(PROJECT_NAME, global.gateFirstPid, rootHeaders)
  global.gateRedJobId = gate.id
  // Assert the gate stopped the change FOR THE RIGHT REASON before screenshotting
  // anything: a job that fails because it cannot even diff would otherwise pose
  // as the proof.
  const redTrace = jobTrace(gate.id, rootHeaders)
  if (gate.status !== 'failed' ||
      !redTrace.includes('Product changed with NO storyboard card changed or added') ||
      !redTrace.includes(PRODUCT_FILE)) {
    console.log(`── ${GATE_JOB} said:\n${gateSection(redTrace)}`)
    throw new Error(`Expected the ${GATE_JOB} job to stop the unproven change, got status=${gate.status}`)
  }
  await waitPipelineTerminal(PROJECT_NAME, global.gateFirstPid, rootHeaders)

  // The merge request as its author finds it: the pipeline failed, so GitLab
  // will not let it merge. Cropped to the header and the merge widget — the
  // activity feed below adds nothing to the story.
  I.resizeWindow(1024, 585)
  await GitLabMergeRequestPage.gotoAndMask(
    projectPath(PROJECT_NAME), global.gateMrIid, PROJECT_NAME,
    { hideMergeWidget: false, waitText: 'Merge blocked' }
  )
  // Wait for the pipeline row to EXIST before hiding it: hidden-but-present and
  // never-rendered are two different layouts, and the widget arrives on its own
  // polling cycle. Waiting makes the DOM the same shape on every run.
  await I.waitForText('Merge request pipeline', 60)
  await I.executeScript(() => {
    // Persistent CSS + observer, not one-shot inline styles: the merge widget is
    // a Vue subtree that re-renders on its own polling cycle, so a node styled
    // once comes back. The pipeline row is doubly volatile — it is absent on
    // some runs and its mini job graph depends on which sibling job the runner
    // had grabbed before being cancelled. What the card must show survives:
    // "Merge blocked: 1 check failed" and "Pipeline must succeed."
    const style = document.createElement('style')
    style.textContent = '[data-e2e-hide] { display: none !important }'
    document.head.appendChild(style)
    const STABLE = /Merge blocked|Approval|Merged by/
    const mark = () => {
      document.querySelectorAll('div, section, li').forEach(el => {
        const text = el.textContent.trim()
        if (text.length < 400 && !STABLE.test(text) &&
            /Checking pipeline status|Merge request pipeline/.test(text)) {
          el.setAttribute('data-e2e-hide', '')
          // Climb to the whole row box: its status icon carries its own
          // visibility and would otherwise stay behind as a lone red cross.
          let up = el.parentElement
          while (up && up !== document.body && !STABLE.test(up.textContent)) {
            up.setAttribute('data-e2e-hide', '')
            up = up.parentElement
          }
        }
      })
    }
    mark()
    new MutationObserver(mark).observe(document.body, { childList: true, subtree: true })
  })
  await I.wait(1)
  await addStoryboardFrame(I, await capturePageFrame(I, 'merge-blocked'))
  I.resizeWindow(1024, 768)
})

storyboardStep(Then, 'the failed job names the file left without proof', async () => {
  const rootHeaders = await getRootHeaders()
  await captureGateJobFrame(global.gateRedJobId, 'gate-names-the-file')
  // Twin: the gate's own words, read straight from the job trace.
  const trace = jobTrace(global.gateRedJobId, rootHeaders)
  if (!trace.includes('Storyboard-exempt:')) {
    throw new Error(`Expected the job trace to offer the visible waiver, got:\n${gateSection(trace)}`)
  }
})

storyboardStep(When, 'the author adds the proof card beside the same framework change', async () => {
  const rootHeaders = await getRootHeaders()
  // The card that proves a change to the release job's CI definition already
  // exists — the crashed-release story. The author extends it, on the SAME
  // merge request, leaving the framework change untouched.
  fs.appendFileSync(
    `${FIXTURE_DIR}/${CARD_FILE}`,
    '\n  # The cleanup this card proves runs whatever the release job does.\n'
  )
  sh([
    `git add ${CARD_FILE}`,
    'git commit --quiet -m "test(e2e): note that this card proves the cleanup"',
    'git push --quiet 2>/dev/null'
  ].join(' && '), FIXTURE_DIR)

  // Twin FIRST: both files are in the merge request now, the framework one
  // untouched since the first push.
  await waitMrChanges(rootHeaders, [PRODUCT_FILE, CARD_FILE])

  // The same Changes tab, one file richer: the fix is visible, not narrated.
  I.resizeWindow(1024, 640)
  await GitLabMergeRequestPage.gotoChangesAndMask(
    projectPath(PROJECT_NAME), global.gateMrIid, PROJECT_NAME, CARD_FILE
  )
  await addStoryboardFrame(I, await capturePageFrame(I, 'changes-with-card'))
  I.resizeWindow(1024, 768)
})

storyboardStep(Then, 'the same job turns green and the change can go in', async () => {
  const rootHeaders = await getRootHeaders()
  const pid = await waitMrPipelineId(PROJECT_NAME, global.gateMrIid, rootHeaders, global.gateFirstPid)
  const gate = await waitGateJob(PROJECT_NAME, pid, rootHeaders)
  const greenTrace = jobTrace(gate.id, rootHeaders)
  if (gate.status !== 'success' || !greenTrace.includes('Product changed and a storyboard was changed/added')) {
    console.log(`── ${GATE_JOB} said:\n${gateSection(greenTrace)}`)
    throw new Error(`Expected the ${GATE_JOB} job to pass once the card is there, got ${gate.status}`)
  }
  await captureGateJobFrame(gate.id, 'gate-names-the-card')

  // Twin: the gate went green BECAUSE of the card.
  if (!greenTrace.includes(CARD_FILE)) {
    throw new Error(`Expected the job trace to name ${CARD_FILE}, got:\n${gateSection(greenTrace)}`)
  }
})
