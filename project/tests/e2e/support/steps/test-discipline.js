/* global inject Given When Then Before After document window */
/**
 * Merge-request gates DOGFOOD: @test-discipline, on the heavy runner shard.
 *
 * Two guards, two chapters, one real merge request.
 *
 * Chapter 1, storyboard-coverage
 * (.config/devsecops/scripts/check-storyboard-coverage.sh, wired as the
 * `storyboard-coverage` job in .config/gitlab/ci/devsecops/test.yml) fails a
 * merge request when product files changed with NO storyboard card changed or
 * added. The gate itself touches .config/**, so by its own rule it owes a
 * visible proof: this is it.
 *
 * Chapter 2, no-cheat (check-no-cheat.sh, the `no-cheat` job) reads the lines
 * the change ADDS and refuses the ones that switch a check off. The same merge
 * request, now carrying its picture, has the scenario behind that picture
 * switched off: the first gate stays green, the second one stops it.
 *
 * The proof is the product, not a reconstruction: the framework working tree is
 * pushed to the in-repo test GitLab, a REAL merge request changes a REAL
 * framework file with no card, and the REAL jobs judge it. Every card is a real
 * GitLab page (Changes tab, merge request, job log), twinned with a REST check
 * of the same fact.
 *
 * The storyboard-coverage job is framework-only (the generated `test.yml.jinja`
 * twin carries no such job, no-cheat aside), so the fixture is the toolbox tree
 * itself, not a copier render. Its pipeline is cut down to the two gates (see
 * trimFixturePipeline): both are real native jobs, so each push costs two git
 * diffs on the single runner slot, and the verdicts, logs and exit codes are
 * entirely real.
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { I, GitLabUserPage } = inject()
const {
  BASE_URL,
  encodedProjectPath,
  getRootHeaders,
  createMergeRequestWhenBranchExists,
  getMergeRequest,
  updateProjectSettings,
  getPipeline,
  listPipelineJobs,
  getJobTrace
} = require('../helpers/gitlabApi')
const { freshGet } = require('../helpers/http')
const { registerScopedRunner, teardownScopedRunner, PIPELINE_TIMEOUT_MS } = require('../helpers/pipelineRunner')
const { publishToGitLab } = require('../helpers/gitlabProject')
const { gitlabFrame, gitlabUrl, jobLogFrame, settlePage } = require('../helpers/gitlabCard')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const GATE_JOB = 'storyboard-coverage'
// The second merge-request guard: it reads the lines the change ADDS and
// refuses the ones that switch a check off. A picture cannot satisfy it.
const NO_CHEAT_JOB = 'no-cheat'
const BRANCH = 'ci-release-cleanup-note'
// The framework tree lives in /workspace inside the codeceptjs container (the
// working branch, tarred in without .git, see project/Taskfile.yml).
const FRAMEWORK_SRC = '/workspace'
const FIXTURE_DIR = '/tmp/e2e-storyboard-gate-repo'
// A REAL framework file changed by the merge request, and the card that covers
// it: the crashed-release story is exactly the proof a change to the release
// job's CI definition owes.
const PRODUCT_FILE = '.config/gitlab/ci/devsecops/release.yml'
const CARD_FILE = 'project/tests/e2e/features/02-daily-work/release-window.feature'
// The picture the new card captures. The gate wants the PICTURE, not a comment
// beside it, so the author's third push carries this file too.
const PROOF_PNG = 'project/tests/e2e/screenshots/base/02-daily-work/release-window/cleanup-on-every-outcome.png'
// That card and that picture are pinned here, as they stood when this story was
// written (the picture is a real frame of the crashed-release story): every
// Changes tab and the no-cheat log quote them, so an edit to the live story
// would otherwise move this story's pictures. The gates read them like any
// other file.
const PINNED = path.join(__dirname, '../../fixtures/test-discipline')
const TERMINAL = ['success', 'failed', 'canceled', 'skipped']

// One run of the story: its published project, merge request, runner, pipelines.
let gate = {}

function sh (cmd, cwd = FIXTURE_DIR) {
  return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000, encoding: 'utf8' }).trimEnd()
}

// The author's push: commit the files on the merge request's branch, push it.
function push (files, message) {
  sh(`git add ${files.join(' ')} && git commit --quiet -m "${message}"`)
  gate.pub.push(BRANCH)
}

async function mrApi (path = '') {
  const res = await freshGet(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(gate.pub.projectName)}/merge_requests/${gate.mrIid}${path}`,
    await getRootHeaders()
  )
  return res.data
}

// GitLab works out most of a merge request asynchronously after a push (its
// diff, commit count, pipeline, merge status): wait for the value the push
// produced, never a guessed delay, and say what was last seen if it never comes.
async function until (what, read, done, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs
  let value
  while (Date.now() < deadline) {
    value = await read()
    if (done(value)) return value
    await I.wait(3)
  }
  throw new Error(`${what}: still ${JSON.stringify(value)} after ${timeoutMs / 1000} s`)
}

// The merge request's own pipeline for the latest push. Every merge-request
// card waits for the commit count AND the pipeline of its push: the tab bar
// prints both, and a capture that lands before either updates is a coin toss.
async function waitPushSettled (commits) {
  await until(`The merge request should count ${commits} commits`,
    async () => ((await mrApi('/commits')) || []).length, n => n >= commits)
  const after = gate.pids.length ? gate.pids[gate.pids.length - 1] : 0
  const ids = await until('A new merge-request pipeline should appear',
    async () => ((await mrApi('/pipelines')) || []).map(p => p.id).filter(id => id > after), fresh => fresh.length)
  gate.pids.push(Math.max(...ids))
}

// The runner has ONE job slot, SHARED with the other stories of this shard: a
// pipeline can sit pending for minutes while a neighbour runs, so wait on the
// suite's own pipeline budget.
async function lastPipelineDone () {
  const pid = gate.pids[gate.pids.length - 1]
  return until(`Pipeline ${pid} should finish`,
    async () => (await getPipeline(gate.pub.projectName, pid, await getRootHeaders())).data.status,
    status => TERMINAL.includes(status), PIPELINE_TIMEOUT_MS)
}

// Both gates of the last pipeline, by name. The fixture runs these two jobs and
// nothing else, so a third one means the trim broke.
async function gateJobs () {
  const pid = gate.pids[gate.pids.length - 1]
  const jobs = (await listPipelineJobs(gate.pub.projectName, pid, await getRootHeaders())).data || []
  const names = jobs.map(j => j.name).sort()
  if (JSON.stringify(names) !== JSON.stringify([NO_CHEAT_JOB, GATE_JOB])) {
    throw new Error(`Expected exactly ${GATE_JOB} and ${NO_CHEAT_JOB} on pipeline ${pid}, got ${names.join(', ')}`)
  }
  return Object.fromEntries(jobs.map(j => [j.name, j]))
}

// A job in the state the card shows, saying what the card quotes. The After hook
// deletes the project, so a failure carries the job's own words.
async function expectJob (job, status, says = []) {
  const trace = await getJobTrace(gate.pub.projectName, job.id, await getRootHeaders())
  const missing = says.filter(text => !trace.includes(text))
  if (job.status !== status || missing.length) {
    throw new Error(`Expected ${job.name} ${status}, saying ${JSON.stringify(missing)}; it is ${job.status} and said:\n${trace.slice(-3000)}`)
  }
}

// The merge status GitLab computes after each pipeline ("checking" first).
function expectMergeStatus (expected) {
  return until(`The merge request should be ${expected}`,
    async () => (await getMergeRequest(gate.pub.projectName, gate.mrIid, await getRootHeaders())).data.detailed_merge_status,
    status => status === expected, 120000)
}

// The diff GitLab serves for the latest push, by its file paths.
function expectDiffPaths (paths) {
  return until(`The merge request diff should hold ${paths.join(', ')}`,
    async () => (((await mrApi('/changes')) || {}).changes || []).map(c => c.new_path),
    seen => seen.length === paths.length && paths.every(p => seen.includes(p)))
}

// The Changes tab with its file tree: the page a reviewer opens to see WHICH
// files are in play. `newText` is something only the latest push shows: GitLab
// can serve the previous diff for a moment, and a reload fetches the new one.
async function changesFrame (frameName, newText, height) {
  await gitlabFrame(I, frameName, gitlabUrl.mr(gate.pub.projectName, gate.mrIid, 'diffs'), {
    height,
    prepare: async () => {
      const deadline = Date.now() + 60000
      while (!await I.executeScript(text => document.body.innerText.includes(text), newText)) {
        if (Date.now() > deadline) throw new Error(`The Changes tab never displayed ${newText}`)
        await I.wait(5)
        await I.refreshPage()
      }
      // GitLab folds the file tree away for a one-file diff: open it, so every
      // Changes card has the same layout and the tree counts the files.
      await I.executeScript(() => {
        if (document.querySelector('[data-testid="file-tree-container"], .diff-tree-list, [class*="tree-list-holder"]')) return
        const toggle = Array.from(document.querySelectorAll('button')).find(b =>
          /file browser|file tree|hide files|show files/i.test(`${b.getAttribute('aria-label') || ''} ${b.title || ''}`))
        if (toggle) toggle.click()
      })
    }
  })
}

const STAGE = '[data-testid="pipeline-mini-graph-dropdown-toggle"]'
const STAGE_JOB = '[data-testid="ci-job-item"]'

// The merge request, its pipeline's one stage opened the way a reader clicks it
// to see WHICH check broke: both jobs listed by name, right above the merge box.
// The stage opens after the mask (the mask moves the page up, and an open menu
// would stay where it was drawn), and is checked open again right before the
// capture: the widget redraws itself on its own polling cycle.
async function mergeRequestFrame (frameName, waitText, height) {
  const openStage = async () => {
    await I.executeScript(() => {
      window.scrollTo(0, 0)
      document.querySelectorAll('main, .content-wrapper, .layout-page, .js-static-panel-inner').forEach(el => { el.scrollTop = 0 })
    })
    for (let attempt = 1; ; attempt++) {
      const toggles = await I.grabNumberOfVisibleElements(STAGE)
      if (toggles !== 1) throw new Error(`Expected the pipeline to show ONE stage, it shows ${toggles}`)
      // A script click: the pointer stays parked, so no hover or tooltip shows.
      await I.executeScript((sel) => document.querySelector(sel).click(), STAGE)
      // waitForFunction hands its argument array over as ONE argument.
      await I.waitForFunction(([sel, names]) => {
        const items = Array.from(document.querySelectorAll(sel)).map(el => el.textContent)
        return items.length === names.length && names.every(n => items.some(t => t.includes(n)))
      }, [STAGE_JOB, [GATE_JOB, NO_CHEAT_JOB]], 30)
      await I.executeScript(() => document.activeElement && document.activeElement.blur())
      await settlePage(I, { quietMs: 500 })
      if (await I.grabNumberOfVisibleElements(STAGE_JOB) === 2) return
      if (attempt === 2) throw new Error('The pipeline stage menu closed itself twice before the capture')
    }
  }
  await gitlabFrame(I, frameName, gitlabUrl.mr(gate.pub.projectName, gate.mrIid), {
    waitText,
    height,
    // "Merge request pipeline failed for <sha> <time>": once both are masked,
    // the line under the pipeline's status says nothing but "for", so it goes
    // with its help icon. The status itself is the line above it.
    hide: ['div:has(> [data-testid="pipeline-details-container"])'],
    scrollTo: openStage
  })
}

// A gate's job page, its log from the gate's own command line on. A green job
// also saves the runner cache: that section is folded, the way a reader clicks
// past it.
function gateLogFrame (frameName, job, { script = 'check-storyboard-coverage.sh', waitText } = {}) {
  return jobLogFrame(I, frameName, gate.pub.projectName, job.id, {
    from: script, waitText, fold: ['Saving cache for successful job'], height: 620
  })
}

// The fixture is the framework tree, because the gate job is framework-only.
// Its pipeline keeps the two gates and nothing else: the `test` job IS this very
// end-to-end suite and would recurse into itself, and every other job runs a
// task no card proves anything about (operate and monitor each booted a
// docker:dind service, eight times per run, on the one shared runner slot).
// The gates' own definitions and scripts are untouched, and the edit lands on
// the fixture's main branch, so the story's diff never shows it.
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

const ownsScenario = (test) => Boolean(test && test.tags && test.tags.includes('@test-discipline'))

Before((test) => {
  if (ownsScenario(test)) gate = { pids: [] }
})

After(async (test) => {
  if (!ownsScenario(test)) return
  if (gate.runner) await teardownScopedRunner(gate.runner, await getRootHeaders()).catch(() => {})
  if (gate.pub) await gate.pub.teardown()
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true })
  gate = {}
})

// The whole off-camera stage in one sentence, closed by its visual proof: the
// framework on its own GitLab project, and a merge request holding exactly one
// framework file and no proof card at all.
storyboardStep(Given, 'the merge request changes one framework file and brings no proof card', async () => {
  const root = await getRootHeaders()
  // chown: the tar-extracted /workspace keeps the HOST uid, and git refuses to
  // work in a repository owned by another user (dubious ownership).
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true })
  sh(`mkdir -p ${FIXTURE_DIR} && cp -a ${FRAMEWORK_SRC}/. ${FIXTURE_DIR} && chown -R "$(id -u):$(id -g)" ${FIXTURE_DIR}`, '/tmp')
  fs.copyFileSync(`${PINNED}/release-window.feature`, `${FIXTURE_DIR}/${CARD_FILE}`)
  trimFixturePipeline()
  gate.pub = await publishToGitLab(FIXTURE_DIR, { message: 'chore: the toolbox as it stands on the main branch' })
  // A merge request may only merge on a green pipeline: the setting the toolbox
  // applies through TASK_GLAB_PIPELINE_MUST_SUCCEED. It is what turns a red job
  // into a blocked merge, and two green ones into a merge button.
  await updateProjectSettings(
    gate.pub.projectName, { only_allow_merge_if_pipeline_succeeds: true, merge_method: 'ff' }, root
  )

  // The merge request: ONE framework file changed, no storyboard file at all.
  fs.appendFileSync(`${FIXTURE_DIR}/${PRODUCT_FILE}`, '\n# The cleanup above runs whatever the release job does, pass or fail.\n')
  sh(`git checkout --quiet -b ${BRANCH}`)
  push([PRODUCT_FILE], 'ci(release): say why the cleanup runs on every outcome')
  const mr = await createMergeRequestWhenBranchExists(gate.pub.projectName, {
    source_branch: BRANCH,
    target_branch: 'main',
    title: 'ci(release): say why the cleanup runs on every outcome',
    description: 'One comment line above the after_script, so the next reader knows the cleanup is not optional.',
    remove_source_branch: true
  }, gate.pub.headers)
  if (mr.status >= 400) throw new Error(`Failed to open the merge request (status ${mr.status}): ${JSON.stringify(mr.data)}`)
  gate.mrIid = mr.data.iid

  gate.runner = await registerScopedRunner(I, gate.pub.projectName, root)
  await waitPushSettled(1)
  const status = await lastPipelineDone()

  // Twin FIRST: the merge request holds the framework file and nothing else,
  // and the gate stopped it for the RIGHT reason (a job that fails because it
  // cannot even diff would otherwise pose as the proof), while the second gate
  // found nothing to say about a plain framework change.
  await expectDiffPaths([PRODUCT_FILE])
  const jobs = await gateJobs()
  if (status !== 'failed') throw new Error(`Expected the first pipeline to fail, it is ${status}`)
  await expectJob(jobs[GATE_JOB], 'failed', ['Product changed with NO storyboard picture to prove it', PRODUCT_FILE, 'Storyboard-exempt:'])
  await expectJob(jobs[NO_CHEAT_JOB], 'success')
  gate.jobs = jobs

  await GitLabUserPage.loginAs(process.env.TASK_GITLAB_LAMBDA_USER, process.env.TASK_GITLAB_LAMBDA_PASSWORD)
  await changesFrame('changes-without-card', PRODUCT_FILE, 460)
})

storyboardStep(Then, 'GitLab refuses to merge it, one check failed', async () => {
  await expectMergeStatus('ci_must_pass')
  await mergeRequestFrame('merge-blocked', 'Merge blocked', 625)
})

storyboardStep(Then, 'the failed job names the file left without proof', async () => {
  await gateLogFrame('gate-names-the-file', gate.jobs[GATE_JOB])
})

storyboardStep(When, 'the author pushes only a comment beside the framework change', async () => {
  // The cheapest thing that LOOKS like a proof: a line of text typed into an
  // existing card. This is exactly what the gate must refuse.
  fs.appendFileSync(`${FIXTURE_DIR}/${CARD_FILE}`, '\n  # The release cleanup runs on every outcome.\n')
  push([CARD_FILE], 'test(e2e): mention the cleanup in the crashed-release card')
  // Twin FIRST: the framework file and the card file, and still no picture.
  await expectDiffPaths([PRODUCT_FILE, CARD_FILE])
  await waitPushSettled(2)
  await changesFrame('changes-comment-only', CARD_FILE, 680)
})

storyboardStep(Then, 'the gate reads that comment and refuses it just the same', async () => {
  const status = await lastPipelineDone()
  const jobs = await gateJobs()
  // Twin: the same red verdict AND the line naming the card file it read: the
  // gate looked at the comment and refused it, it was not simply unaware.
  if (status !== 'failed') throw new Error(`Expected the comment to change nothing, the pipeline is ${status}`)
  await expectJob(jobs[GATE_JOB], 'failed', ['Product changed with NO storyboard picture to prove it', 'it captured no picture', CARD_FILE])
  await gateLogFrame('gate-refuses-the-comment', jobs[GATE_JOB], { waitText: 'it captured no picture' })
})

storyboardStep(When, 'the author adds the card and the picture it captured', async () => {
  // The card that proves a change to the release job's CI definition already
  // exists: the crashed-release story. The author extends it, on the SAME
  // merge request, leaving the framework change untouched.
  fs.appendFileSync(
    `${FIXTURE_DIR}/${CARD_FILE}`,
    '\n    # Note: The cleanup runs whatever the release job does, pass or fail.\n' +
    '    And the cleanup runs on every outcome\n'
  )
  fs.copyFileSync(`${PINNED}/cleanup-on-every-outcome.png`, `${FIXTURE_DIR}/${PROOF_PNG}`)
  push([CARD_FILE, PROOF_PNG], 'test(e2e): capture the cleanup that runs on every outcome')
  // Twin FIRST: the sentence AND the picture it captured are both in the merge
  // request; the gate only accepts the picture.
  await expectDiffPaths([PRODUCT_FILE, CARD_FILE, PROOF_PNG])
  await waitPushSettled(3)
  await changesFrame('changes-with-card', PROOF_PNG.split('/').pop(), 1100)
})

storyboardStep(Then, 'the same job turns green and names the card that proved the change', async () => {
  const status = await lastPipelineDone()
  const jobs = await gateJobs()
  if (status !== 'success') throw new Error(`Expected a green pipeline once the card is there, it is ${status}`)
  await expectJob(jobs[GATE_JOB], 'success', ['Product changed and a storyboard captured it', PROOF_PNG])
  await expectJob(jobs[NO_CHEAT_JOB], 'success')
  await gateLogFrame('gate-names-the-card', jobs[GATE_JOB])
})

storyboardStep(Then, 'the merge request is green from end to end and can be merged', async () => {
  await expectMergeStatus('mergeable')
  await mergeRequestFrame('merge-allowed', 'Ready to merge', 585)
})

// ---------------------------------------------------------------------------
// Chapter 2: the card is there, and the test behind it was switched off
// ---------------------------------------------------------------------------
//
// The first gate asks ONE question: did a picture come with this change. It
// cannot ask whether the scenario taking that picture still runs, and a single
// tag is enough to stop it running for good. That is what the second gate reads.

storyboardStep(When, 'the author switches the test off instead of fixing what it caught', async () => {
  // The cheapest way to turn a red pipeline green: tell the suite to walk past
  // the scenario. The card and its picture both stay exactly where they are.
  const card = `${FIXTURE_DIR}/${CARD_FILE}`
  const before = fs.readFileSync(card, 'utf8')
  const after = before.replace(/^(\s*)@release-window$/m, (_, indent) => `${indent}@skip\n${indent}@release-window`)
  if (after === before) throw new Error(`Could not find the scenario tag to switch off in ${CARD_FILE}`)
  fs.writeFileSync(card, after)
  gate.skipLine = after.split('\n').findIndex(l => l.trim() === '@skip') + 1
  push([CARD_FILE], 'test(e2e): step over the crashed-release scenario for now')
  // Twin FIRST: the merge request still carries the picture from chapter 1, so
  // whatever happens next is not about a missing picture.
  await expectDiffPaths([PRODUCT_FILE, CARD_FILE, PROOF_PNG])
  await waitPushSettled(4)
  await changesFrame('changes-test-switched-off', '@skip', 1100)
})

storyboardStep(Then, 'GitLab stops the merge request again, on the check a picture cannot satisfy', async () => {
  const status = await lastPipelineDone()
  const jobs = await gateJobs()
  // Twin: the picture gate is GREEN on the very push that switches the test off
  // (it was asked whether a picture came with the change, and one did), and the
  // second gate is the one that stops the merge request.
  if (status !== 'failed') throw new Error(`Expected the switched-off test to fail the pipeline, it is ${status}`)
  await expectJob(jobs[GATE_JOB], 'success', ['Product changed and a storyboard captured it', PROOF_PNG])
  await expectJob(jobs[NO_CHEAT_JOB], 'failed')
  gate.jobs = jobs
  await expectMergeStatus('ci_must_pass')
  await mergeRequestFrame('merge-blocked-again', 'Merge blocked', 625)
})

storyboardStep(Then, 'the second check reads the change itself and names the line that switched the test off', async () => {
  // Twin: red for the RIGHT reason: it names the file it read, says what the
  // added line does, and offers its visible waiver.
  await expectJob(gate.jobs[NO_CHEAT_JOB], 'failed', [
    'This change switches a check off instead of fixing what it caught',
    `${CARD_FILE}:${gate.skipLine}`, '@skip', 'without ever running it', 'No-cheat-exempt:'
  ])
  await gateLogFrame('no-cheat-names-the-line', gate.jobs[NO_CHEAT_JOB], {
    script: 'check-no-cheat.sh', waitText: 'No-cheat gate'
  })
})
