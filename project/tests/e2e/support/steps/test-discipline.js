/* global inject Given When Then Before After NodeFilter */
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
const { freshGet } = require('../helpers/http')
const {
  registerScopedRunner,
  teardownScopedRunner,
  maskPipelinePage
} = require('../helpers/pipelineRunner')
const { storyboardStep, addStoryboardFrame, capturePageFrame } = require('../../../../../.config/codeceptjs/storyboard')

const PROJECT_NAME = 'e2e-storyboard-gate'
const GATE_JOB = 'storyboard-coverage'
const BRANCH = 'ci-release-cleanup-note'
// Wide enough for GitLab to render the reviewer's context: the file tree beside
// a diff, the job list beside a job log.
const WIDE = 1440
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

// The gate job of a pipeline, once that pipeline reached a terminal state.
async function gateJobOf (projectName, pid, headers) {
  const jobs = (await listPipelineJobs(projectName, pid, headers)).data || []
  const gate = jobs.find(j => j.name === GATE_JOB)
  if (!gate) throw new Error(`No "${GATE_JOB}" job on pipeline ${pid} (${jobs.map(j => j.name).join(', ')})`)
  return { gate, jobs }
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
async function captureGateJobFrame (jobId, frameName, height) {
  // Wide, so the card carries where the reader is: the project breadcrumb, the
  // job's own name and status, and the pipeline's other jobs in the left panel.
  I.resizeWindow(WIDE, height)
  await I.amOnPage(`/${projectPath(PROJECT_NAME)}/-/jobs/${jobId}`)
  await I.waitForElement('[data-testid="job-log-content"]', 60)
  await I.waitForText('Storyboard-coverage gate', 60)
  await maskPipelinePage(I, PROJECT_NAME, { keepContext: true })
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

// The Changes tab of the merge request, with its file tree — the page a
// reviewer opens to see WHICH files are in play.
async function captureChangesFrame (waitPath, frameName, height) {
  I.resizeWindow(WIDE, height)
  await GitLabMergeRequestPage.gotoChangesAndMask(
    projectPath(PROJECT_NAME), global.gateMrIid, PROJECT_NAME, waitPath
  )
  await addStoryboardFrame(I, await capturePageFrame(I, frameName))
  I.resizeWindow(1024, 768)
}

// The merge request itself, waited into a settled state, with its pipeline row
// and merge widget kept: they ARE the story here.
async function captureMergeRequestFrame (waitText, frameName, height) {
  I.resizeWindow(WIDE, height)
  await GitLabMergeRequestPage.gotoAndMask(
    projectPath(PROJECT_NAME), global.gateMrIid, PROJECT_NAME,
    { hideMergeWidget: false, waitText, keepContext: true }
  )
  await addStoryboardFrame(I, await capturePageFrame(I, frameName))
  I.resizeWindow(1024, 768)
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

// The fixture is the framework tree, because the gate job is framework-only (the
// generated `test.yml.jinja` twin carries no such job). Two edits, both made on
// the fixture's MAIN branch and both invisible to the story's diff:
//   - the pipeline keeps only the jobs a nested GitLab can actually finish
//     (monitor, operate) plus the gate itself, so the pipeline the cards show is
//     a REAL one that runs to a real verdict instead of a wall of cancelled jobs;
//   - the `test` job is dropped, because it IS this very end-to-end suite and
//     would recurse into itself.
// The gate job's own definition and script are untouched.
function trimFixturePipeline () {
  const ci = `${FIXTURE_DIR}/.gitlab-ci.yml`
  const kept = [
    '.config/gitlab/ci/before_script.yml',
    '.config/gitlab/ci/cache.yml',
    '.config/gitlab/ci/services.yml',
    '.config/gitlab/ci/stages.yml',
    '.config/gitlab/ci/tags.yml',
    '.config/gitlab/ci/variables.yml',
    '.config/gitlab/ci/workflow.yml',
    '.config/gitlab/ci/devsecops/monitor.yml',
    '.config/gitlab/ci/devsecops/operate.yml',
    '.config/gitlab/ci/devsecops/test.yml'
  ]
  const head = fs.readFileSync(ci, 'utf8').split(/^include:/m)[0]
  fs.writeFileSync(ci, `${head}include:\n${kept.map(f => `  - local: ${f}\n`).join('')}`)

  const testYml = `${FIXTURE_DIR}/.config/gitlab/ci/devsecops/test.yml`
  const lines = fs.readFileSync(testYml, 'utf8').split('\n')
  const from = lines.findIndex(l => /^test:\s*$/.test(l))
  const to = lines.findIndex((l, i) => i > from && /^[a-zA-Z][\w-]*:\s*$/.test(l))
  if (from === -1 || to === -1) throw new Error('Could not locate the test job in the fixture CI')
  lines.splice(from, to - from)
  fs.writeFileSync(testYml, lines.join('\n'))
}

// The whole off-camera stage in one sentence, closed by its visual proof: the
// framework on its own GitLab project, and a merge request holding exactly one
// framework file and no proof card at all.
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
  // red cross into a blocked merge, and its green tick into a merge button.
  await updateProjectSettings(
    PROJECT_NAME, { only_allow_merge_if_pipeline_succeeds: true, merge_method: 'ff' }, rootHeaders
  )

  const user = lambdaUser()
  const remote = `http://${user}:${encodeURIComponent(token)}@gitlab/${user}/${PROJECT_NAME}.git`
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true })
  // chown: the tar-extracted /workspace keeps the HOST uid, and git refuses to
  // work in a repository owned by another user (dubious ownership).
  sh(`mkdir -p ${FIXTURE_DIR} && cp -a ${FRAMEWORK_SRC}/. ${FIXTURE_DIR} && chown -R "$(id -u):$(id -g)" ${FIXTURE_DIR}`, '/tmp')
  trimFixturePipeline()
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

  // The push to main spawned its own pipeline; delete it so the merge request's
  // own pipeline is the only one, on the single job slot and on the tab counter.
  const pid = await waitMrPipelineId(PROJECT_NAME, global.gateMrIid, rootHeaders)
  global.gateFirstPid = pid
  try {
    const pipes = await listProjectPipelines(PROJECT_NAME, rootHeaders)
    for (const p of (pipes.data || [])) {
      if (p.id === pid) continue
      await cancelPipeline(PROJECT_NAME, p.id, rootHeaders)
      await deletePipeline(PROJECT_NAME, p.id, rootHeaders)
    }
  } catch (_) {}
  global.gateRunner = await registerScopedRunner(I, PROJECT_NAME, rootHeaders)
  const status = await waitPipelineTerminal(PROJECT_NAME, pid, rootHeaders)

  // Twin FIRST, never screenshot a state you have not verified: the merge
  // request holds product and no storyboard file, and the gate stopped it for
  // the RIGHT reason (a job that fails because it cannot even diff would
  // otherwise pose as the proof).
  const paths = await waitMrChanges(rootHeaders, [PRODUCT_FILE])
  if (paths.length !== 1) {
    throw new Error(`Expected only ${PRODUCT_FILE} in the merge request, got ${JSON.stringify(paths)}`)
  }
  const { gate, jobs } = await gateJobOf(PROJECT_NAME, pid, rootHeaders)
  global.gateRedJobId = gate.id
  const redTrace = jobTrace(gate.id, rootHeaders)
  const others = jobs.filter(j => j.name !== GATE_JOB)
  if (gate.status !== 'failed' || status !== 'failed' ||
      !redTrace.includes('Product changed with NO storyboard card changed or added') ||
      !redTrace.includes(PRODUCT_FILE)) {
    console.log(`── ${GATE_JOB} said:\n${gateSection(redTrace)}`)
    throw new Error(`Expected the ${GATE_JOB} job to stop the unproven change; pipeline=${status}, jobs=${jobs.map(j => `${j.name}:${j.status}`).join(', ')}`)
  }
  if (others.some(j => j.status !== 'success')) {
    throw new Error(`Expected every other job green, got ${others.map(j => `${j.name}:${j.status}`).join(', ')}`)
  }

  await GitLabUserPage.loginAs(process.env.TASK_GITLAB_LAMBDA_USER, process.env.TASK_GITLAB_LAMBDA_PASSWORD)
  await captureChangesFrame(PRODUCT_FILE, 'changes-without-card', 700)
})

storyboardStep(Then, 'GitLab refuses to merge it, one check failed', async () => {
  await captureMergeRequestFrame('Merge blocked', 'merge-blocked', 740)
})

storyboardStep(Then, 'the failed job names the file left without proof', async () => {
  const rootHeaders = await getRootHeaders()
  await captureGateJobFrame(global.gateRedJobId, 'gate-names-the-file', 690)
  // Twin: the gate offers its one visible waiver, in its own words.
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

  // Twin FIRST: both files are in the merge request now.
  await waitMrChanges(rootHeaders, [PRODUCT_FILE, CARD_FILE])
  await captureChangesFrame(CARD_FILE, 'changes-with-card', 820)
})

storyboardStep(Then, 'the same job turns green and names the card that proved the change', async () => {
  const rootHeaders = await getRootHeaders()
  const pid = await waitMrPipelineId(PROJECT_NAME, global.gateMrIid, rootHeaders, global.gateFirstPid)
  global.gateSecondPid = pid
  const status = await waitPipelineTerminal(PROJECT_NAME, pid, rootHeaders)
  const { gate, jobs } = await gateJobOf(PROJECT_NAME, pid, rootHeaders)
  const greenTrace = jobTrace(gate.id, rootHeaders)
  if (status !== 'success' || gate.status !== 'success' ||
      !greenTrace.includes('Product changed and a storyboard was changed/added') ||
      !greenTrace.includes(CARD_FILE)) {
    console.log(`── ${GATE_JOB} said:\n${gateSection(greenTrace)}`)
    throw new Error(`Expected a green pipeline once the card is there; pipeline=${status}, jobs=${jobs.map(j => `${j.name}:${j.status}`).join(', ')}`)
  }
  await captureGateJobFrame(gate.id, 'gate-names-the-card', 690)
})

storyboardStep(Then, 'the merge request is green from end to end and can be merged', async () => {
  await captureMergeRequestFrame('Ready to merge', 'merge-allowed', 740)
})
