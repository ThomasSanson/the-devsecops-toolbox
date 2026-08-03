/* global inject Given When Then Before After NodeFilter */
/**
 * Merge-request gate DOGFOOD — @test-discipline, on the heavy runner shard.
 *
 * Two guards, two chapters, one real merge request.
 *
 * Chapter 1 — storyboard-coverage
 * (.config/devsecops/scripts/check-storyboard-coverage.sh, wired as the
 * `storyboard-coverage` job in .config/gitlab/ci/devsecops/test.yml) fails a
 * merge request when product files changed with NO storyboard card changed or
 * added. The gate itself touches .config/**, so by its own rule it owes a
 * visible proof — this is it.
 *
 * Chapter 2 — no-cheat (check-no-cheat.sh, the `no-cheat` job) reads the lines
 * the change ADDS and refuses the ones that switch a check off. Its own proof
 * belongs here rather than in a story of its own: the same merge request, now
 * carrying its picture, has the scenario behind that picture switched off. The
 * first gate stays green — a picture did come with the change — and the second
 * one is what stops it. Reusing this scenario also keeps the runner on one
 * shard instead of adding a second one elsewhere.
 *
 * The proof is the product, not a reconstruction: the framework working tree is
 * pushed to the in-repo test GitLab, a REAL merge request changes a REAL
 * framework file with no card, and the REAL job stops it. Then the card is
 * pushed to the same merge request and the same job goes green. Every card is a
 * real GitLab page (merge request, job log), twinned with a REST check of the
 * same fact.
 *
 * The storyboard-coverage job is framework-only (the generated `test.yml.jinja`
 * twin carries no such job, no-cheat aside), so the fixture is the toolbox tree
 * itself — not a copier render.
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
  curlAuthFlags,
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
  maskPipelinePage,
  PIPELINE_TIMEOUT_MS
} = require('../helpers/pipelineRunner')
const { storyboardStep, addStoryboardFrame, capturePageFrame } = require('../../../../../.config/codeceptjs/storyboard')

const PROJECT_NAME = 'e2e-storyboard-gate'
const GATE_JOB = 'storyboard-coverage'
// The second merge-request guard, twin of the first: it reads the lines the
// change ADDS and refuses the ones that switch a check off. A picture cannot
// satisfy it, which is the whole point of chapter 2.
const NO_CHEAT_JOB = 'no-cheat'
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
// The baseline the new card captures. The gate wants the PICTURE, not a comment
// beside it, so the author's second push carries this file too. The fixture
// stages it from a real frame of that same story — the demo is about the gate's
// verdict, and every pixel of that frame is a genuine capture.
const PROOF_PNG = 'project/tests/e2e/screenshots/base/02-daily-work/release-window/cleanup-on-every-outcome.png'
const STAGED_FROM = 'project/tests/e2e/screenshots/base/02-daily-work/release-window/after-script-relock.png'

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

// A named job of a pipeline, once that pipeline reached a terminal state.
async function jobOf (projectName, pid, headers, name = GATE_JOB) {
  const jobs = (await listPipelineJobs(projectName, pid, headers)).data || []
  const gate = jobs.find(j => j.name === name)
  if (!gate) throw new Error(`No "${name}" job on pipeline ${pid} (${jobs.map(j => j.name).join(', ')})`)
  return { gate, jobs }
}

// The runner has ONE job slot and it is SHARED with the other stories of this
// shard: a pipeline can sit pending for minutes while a neighbour runs. Wait on
// the suite's own pipeline budget, never a private short one.
async function waitPipelineTerminal (projectName, pid, headers) {
  const deadline = Date.now() + PIPELINE_TIMEOUT_MS
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
async function captureGateJobFrame (jobId, frameName, height, opts = {}) {
  const waitText = opts.waitText || 'Storyboard-coverage gate'
  const script = opts.script || 'check-storyboard-coverage.sh'
  // Wide, so the card carries where the reader is: the project breadcrumb, the
  // job's own name and status, and the pipeline's other jobs in the left panel.
  I.resizeWindow(WIDE, height)
  await I.amOnPage(`/${projectPath(PROJECT_NAME)}/-/jobs/${jobId}`)
  await I.waitForElement('[data-testid="job-log-content"]', 60)
  await I.waitForText(waitText, 60)
  await maskPipelinePage(I, PROJECT_NAME, { keepContext: true })
  await I.executeScript((marker) => {
    // Collapse the log to the gate's own run, the way a reader clicks past the
    // runner's boilerplate: everything before the command line goes (cache
    // restore, image pull — and with them the toolbox version and image digest,
    // which move on every release).
    const lines = Array.from(document.querySelectorAll('.js-log-line.job-log-line'))
    const start = lines.findIndex(l => l.textContent.includes(marker))
    if (start > 0) lines.slice(0, start).forEach(l => { l.style.display = 'none' })
    document.querySelectorAll(
      '.job-log-line-number, [class*="log-line-timestamp"], [class*="line-timestamp"]'
    ).forEach(el => { el.style.display = 'none' })
    // gitlab-runner 19 signs off with a cleanup line of its own — "Possibly
    // zombie container runner-<token>--project-…-docker-0 is disconnected from
    // network …" — naming a container built from the runner token this story
    // registers fresh every run. It is the runner tidying up after itself, not
    // the gate speaking, and it appears or not depending on the runner version.
    lines.forEach(l => {
      if (l.textContent.includes('Possibly zombie container')) l.style.display = 'none'
    })
    const log = document.querySelector('[data-testid="job-log-content"]')
    if (!log) return
    const walker = document.createTreeWalker(log, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    nodes.forEach(n => {
      const v = n.nodeValue.replace(/\b[0-9a-f]{8,}\b/g, '<sha>')
      if (v !== n.nodeValue) n.nodeValue = v
    })
  }, script)
  await I.wait(1)
  // Back to the top LAST: GitLab scrolls the page down on its own once the log
  // finishes rendering, and a card that starts below the job's name and status
  // pill no longer says which job the reader is looking at.
  await I.executeScript(() => { window.scrollTo(0, 0) })
  await I.wait(0.5)
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

// GitLab counts the merge request's commits asynchronously, and that count is
// printed on the tab bar of every merge-request page. A capture taken while it
// still reads the previous number is a coin toss between two pictures — worth
// 0.004% of pixels, which at tolerance 0 is the difference between green and
// red, and it fell the other way in CI than it did locally. EVERY card that
// opens a merge-request page waits for the count its own push produced.
// Both counters, because the tab bar prints both: the commits the push added
// AND the pipeline GitLab creates for it. Either one caught mid-update is the
// same coin toss, and the pipeline is the slower of the two.
async function waitMrSettled (headers, commits, afterPid = 0) {
  await waitMrCommits(headers, commits)
  return waitMrPipelineId(PROJECT_NAME, global.gateMrIid, headers, afterPid)
}

async function waitMrCommits (headers, expected) {
  const deadline = Date.now() + 120000
  let seen = 0
  while (Date.now() < deadline) {
    const res = await freshGet(
      `${BASE_URL}/api/v4/projects/${encodedProjectPath(PROJECT_NAME)}/merge_requests/${global.gateMrIid}/commits`,
      headers
    )
    seen = ((res.data) || []).length
    if (seen >= expected) return seen
    await I.wait(3)
  }
  throw new Error(`The merge request still reports ${seen} commits, expected ${expected}`)
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
  return sh(
    `curl -s ${curlAuthFlags(headers)} '${BASE_URL}/api/v4/projects/${encodedProjectPath(PROJECT_NAME)}/jobs/${jobId}/trace'`,
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
  global.gateSecondPid = null
  global.gateThirdPid = null
  global.gateFourthPid = null
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
  const { gate, jobs } = await jobOf(PROJECT_NAME, pid, rootHeaders)
  global.gateRedJobId = gate.id
  const redTrace = jobTrace(gate.id, rootHeaders)
  const others = jobs.filter(j => j.name !== GATE_JOB)
  if (gate.status !== 'failed' || status !== 'failed' ||
      !redTrace.includes('Product changed with NO storyboard picture to prove it') ||
      !redTrace.includes(PRODUCT_FILE)) {
    console.log(`── ${GATE_JOB} said:\n${gateSection(redTrace)}`)
    throw new Error(`Expected the ${GATE_JOB} job to stop the unproven change; pipeline=${status}, jobs=${jobs.map(j => `${j.name}:${j.status}`).join(', ')}`)
  }
  if (others.some(j => j.status !== 'success')) {
    throw new Error(`Expected every other job green, got ${others.map(j => `${j.name}:${j.status}`).join(', ')}`)
  }

  await GitLabUserPage.loginAs(process.env.TASK_GITLAB_LAMBDA_USER, process.env.TASK_GITLAB_LAMBDA_PASSWORD)
  await waitMrCommits(rootHeaders, 1)
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

storyboardStep(When, 'the author pushes only a comment beside the framework change', async () => {
  const rootHeaders = await getRootHeaders()
  // The cheapest thing that LOOKS like a proof: a line of text typed into an
  // existing card. This is exactly what the gate must refuse.
  fs.appendFileSync(
    `${FIXTURE_DIR}/${CARD_FILE}`,
    '\n  # The release cleanup runs on every outcome.\n'
  )
  sh([
    `git add ${CARD_FILE}`,
    'git commit --quiet -m "test(e2e): mention the cleanup in the crashed-release card"',
    'git push --quiet 2>/dev/null'
  ].join(' && '), FIXTURE_DIR)

  // Twin FIRST: the merge request now holds the framework file and the card
  // file, and still not a single picture.
  const paths = await waitMrChanges(rootHeaders, [PRODUCT_FILE, CARD_FILE])
  if (paths.some(p => /^project\/tests\/e2e\/screenshots\/base\/.+\.png$/.test(p))) {
    throw new Error(`Expected NO baseline in the merge request yet, got ${JSON.stringify(paths)}`)
  }
  global.gateSecondPid = await waitMrSettled(rootHeaders, 2, global.gateFirstPid)
  await captureChangesFrame(CARD_FILE, 'changes-comment-only', 820)
})

storyboardStep(Then, 'the gate reads that comment and refuses it just the same', async () => {
  const rootHeaders = await getRootHeaders()
  const pid = global.gateSecondPid
  const status = await waitPipelineTerminal(PROJECT_NAME, pid, rootHeaders)
  const { gate, jobs } = await jobOf(PROJECT_NAME, pid, rootHeaders)
  const trace = jobTrace(gate.id, rootHeaders)
  // Twin: the same red verdict AND the line that names the card file it read —
  // the gate looked at the comment and refused it, it was not simply unaware.
  if (status !== 'failed' || gate.status !== 'failed' ||
      !trace.includes('Product changed with NO storyboard picture to prove it') ||
      !trace.includes('it captured no picture') || !trace.includes(CARD_FILE)) {
    console.log(`── ${GATE_JOB} said:\n${gateSection(trace)}`)
    throw new Error(`Expected the comment to change nothing; pipeline=${status}, jobs=${jobs.map(j => `${j.name}:${j.status}`).join(', ')}`)
  }
  await captureGateJobFrame(gate.id, 'gate-refuses-the-comment', 690)
})

storyboardStep(When, 'the author adds the card and the picture it captured', async () => {
  const rootHeaders = await getRootHeaders()
  // The card that proves a change to the release job's CI definition already
  // exists — the crashed-release story. The author extends it, on the SAME
  // merge request, leaving the framework change untouched.
  fs.appendFileSync(
    `${FIXTURE_DIR}/${CARD_FILE}`,
    '\n    # Note: The cleanup runs whatever the release job does, pass or fail.\n' +
    '    And the cleanup runs on every outcome\n'
  )
  fs.copyFileSync(`${FIXTURE_DIR}/${STAGED_FROM}`, `${FIXTURE_DIR}/${PROOF_PNG}`)
  sh([
    `git add ${CARD_FILE} ${PROOF_PNG}`,
    'git commit --quiet -m "test(e2e): capture the cleanup that runs on every outcome"',
    'git push --quiet 2>/dev/null'
  ].join(' && '), FIXTURE_DIR)

  // Twin FIRST: the sentence AND the picture it captured are both in the merge
  // request — the gate only accepts the picture.
  await waitMrChanges(rootHeaders, [PRODUCT_FILE, CARD_FILE, PROOF_PNG])
  global.gateThirdPid = await waitMrSettled(rootHeaders, 3, global.gateSecondPid)
  await captureChangesFrame(PROOF_PNG.split('/').pop(), 'changes-with-card', 1120)
})

storyboardStep(Then, 'the same job turns green and names the card that proved the change', async () => {
  const rootHeaders = await getRootHeaders()
  const pid = global.gateThirdPid
  const status = await waitPipelineTerminal(PROJECT_NAME, pid, rootHeaders)
  const { gate, jobs } = await jobOf(PROJECT_NAME, pid, rootHeaders)
  const greenTrace = jobTrace(gate.id, rootHeaders)
  if (status !== 'success' || gate.status !== 'success' ||
      !greenTrace.includes('Product changed and a storyboard captured it') ||
      !greenTrace.includes(PROOF_PNG)) {
    console.log(`── ${GATE_JOB} said:\n${gateSection(greenTrace)}`)
    throw new Error(`Expected a green pipeline once the card is there; pipeline=${status}, jobs=${jobs.map(j => `${j.name}:${j.status}`).join(', ')}`)
  }
  await captureGateJobFrame(gate.id, 'gate-names-the-card', 690)
})

storyboardStep(Then, 'the merge request is green from end to end and can be merged', async () => {
  await captureMergeRequestFrame('Ready to merge', 'merge-allowed', 740)
})

// ---------------------------------------------------------------------------
// Chapter 2 — the card is there, and the test behind it was switched off
// ---------------------------------------------------------------------------
//
// The first gate asks ONE question: did a picture come with this change. It
// cannot ask whether the scenario taking that picture still runs, and a single
// tag is enough to stop it running for good. That is what the second gate reads.

storyboardStep(When, 'the author switches the test off instead of fixing what it caught', async () => {
  const rootHeaders = await getRootHeaders()
  // The cheapest way to turn a red pipeline green: tell the suite to walk past
  // the scenario. The card and its picture both stay exactly where they are.
  const card = `${FIXTURE_DIR}/${CARD_FILE}`
  const before = fs.readFileSync(card, 'utf8')
  const after = before.replace(/^(\s*)@release-window$/m, (_, indent) => `${indent}@skip\n${indent}@release-window`)
  if (after === before) throw new Error(`Could not find the scenario tag to switch off in ${CARD_FILE}`)
  fs.writeFileSync(card, after)
  sh([
    `git add ${CARD_FILE}`,
    'git commit --quiet -m "test(e2e): step over the crashed-release scenario for now"',
    'git push --quiet 2>/dev/null'
  ].join(' && '), FIXTURE_DIR)

  // Twin FIRST: the merge request still carries the picture from chapter 1 —
  // whatever the second gate says next, it is not about a missing picture.
  const paths = await waitMrChanges(rootHeaders, [PRODUCT_FILE, CARD_FILE, PROOF_PNG])
  if (!paths.includes(PROOF_PNG)) {
    throw new Error(`Expected the picture to still be in the merge request, got ${JSON.stringify(paths)}`)
  }
  // Four pushes, four commits, four pipelines — the tab bar must say so before
  // it is shot.
  global.gateFourthPid = await waitMrSettled(rootHeaders, 4, global.gateThirdPid)
  await captureChangesFrame(CARD_FILE, 'changes-test-switched-off', 1120)
})

storyboardStep(Then, 'the picture check is satisfied: the card and its picture are both still there', async () => {
  const rootHeaders = await getRootHeaders()
  const pid = global.gateFourthPid
  await waitPipelineTerminal(PROJECT_NAME, pid, rootHeaders)
  const { gate } = await jobOf(PROJECT_NAME, pid, rootHeaders)
  const trace = jobTrace(gate.id, rootHeaders)
  // Twin: the first gate is GREEN on the very push that switches the test off.
  // It was asked whether a picture came with the change, and one did.
  if (gate.status !== 'success' || !trace.includes('Product changed and a storyboard captured it')) {
    console.log(`── ${GATE_JOB} said:\n${gateSection(trace)}`)
    throw new Error(`Expected ${GATE_JOB} to stay green on the doctored push, got ${gate.status}`)
  }
  await captureGateJobFrame(gate.id, 'picture-check-still-green', 690)
})

storyboardStep(Then, 'the second check reads the change itself and names the line that switched the test off', async () => {
  const rootHeaders = await getRootHeaders()
  const { gate, jobs } = await jobOf(PROJECT_NAME, global.gateFourthPid, rootHeaders, NO_CHEAT_JOB)
  const trace = jobTrace(gate.id, rootHeaders)
  // Twin: the second gate is RED, and red for the RIGHT reason — it names the
  // file it read, says what the added line does, and offers its visible waiver.
  if (gate.status !== 'failed' ||
      !trace.includes('This change switches a check off instead of fixing what it caught') ||
      !trace.includes(CARD_FILE) || !trace.includes('without ever running it') ||
      !trace.includes('No-cheat-exempt:')) {
    console.log(`── ${NO_CHEAT_JOB} said:\n${trace.slice(-4000)}`)
    throw new Error(`Expected ${NO_CHEAT_JOB} to name the switched-off scenario; jobs=${jobs.map(j => `${j.name}:${j.status}`).join(', ')}`)
  }
  await captureGateJobFrame(gate.id, 'no-cheat-names-the-line', 720, {
    waitText: 'No-cheat gate', script: 'check-no-cheat.sh'
  })
})

storyboardStep(Then, 'GitLab stops the merge request again, on the check a picture cannot satisfy', async () => {
  await captureMergeRequestFrame('Merge blocked', 'merge-blocked-again', 740)
})
