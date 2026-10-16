/* global inject Given When Then Before After document window */
/**
 * Daily-contribution storyboard: @daily-contribution, on its own shard.
 *
 * A project the installer already set up gets one everyday change and carries
 * it the way a developer does: the issue first, the merge request created from
 * it and self-assigned, a one-line README committed as a conventional `feat:`
 * on the issue's branch and pushed from a real terminal, the merge once the
 * merge request pipeline passes, then the main branch's OWN pipeline cutting
 * 0.2.0: the release job's log, then the release commit and its tag. The
 * developer stays signed in on every GitLab page. ONE Gherkin sentence = ONE
 * card = ONE pixel baseline, asserted inside the step (tolerance: 0): six real
 * GitLab pages (gitlabFrame / jobLogFrame) and one live terminal, each twinned
 * with a REST or terminal check of the same fact.
 *
 * The real MR and main pipelines run on a project-scoped runner registered
 * inside the shared gitlab-runner compose service and torn down surgically (its
 * own token only), see support/helpers/pipelineRunner.js. The workflow rules
 * (.config/gitlab/ci/workflow.yml) keep the pipelines to exactly two: the push
 * to the issue's branch only feeds the merge request pipeline, and the release's
 * "build: bump version" commit and its tag start none.
 */
const fs = require('fs')
const { I, GitLabProjectPage, GitLabUserPage } = inject()
const {
  BASE_URL,
  projectPath,
  encodedProjectPath,
  getRootHeaders,
  createProjectAccessToken,
  createProjectVariable,
  updateProjectSettings,
  listRepositoryTree,
  listProjectPipelines,
  listPipelineJobs,
  deletePipeline,
  getLambdaUserId,
  createProjectIssue,
  createRepositoryBranch,
  createMergeRequest,
  getMergeRequest,
  mergeMergeRequest,
  listProjectBranches,
  listProjectTags,
  getJobTrace,
  getRepositoryFile
} = require('../helpers/gitlabApi')
const {
  registerScopedRunner,
  teardownScopedRunner,
  waitMergeRequestPipeline,
  waitRefPipeline,
  dumpFailedTraces
} = require('../helpers/pipelineRunner')
const { freshGet } = require('../helpers/http')
const { renderProject } = require('../helpers/copierRender')
const { publishToGitLab } = require('../helpers/gitlabProject')
const { setupClonedProjectTerminal, teardownJourneyTerminal } = require('../helpers/journeyContainer')
const { gitlabUrl, gitlabFrame, jobLogFrame, settlePage } = require('../helpers/gitlabCard')
const {
  openTerminal,
  clearTerminal,
  typeCommandAndWait,
  captureTerminalFrame,
  terminalScreenText
} = require('../terminal/capture')
const { storyboardStep, addStoryboardFrame } = require('../../../../../.config/codeceptjs/storyboard')

const PROJECT_NAME = 'e2e-daily-contribution'
const SCAFFOLD_COMMIT = 'chore: scaffold the project from the devsecops toolbox'
const ISSUE_TITLE = 'Mention the toolbox in the README'
// The branch GitLab's "Create merge request" button would open from issue #1.
const BRANCH = '1-mention-the-toolbox-in-the-readme'
const README_LINE = 'This project was scaffolded with The DevSecOps Toolbox.'
const COMMIT_SUBJECT = 'feat: mention the toolbox in the readme'
const BUMP_SUBJECT = 'build: bump version 0.1.0 → 0.2.0'
// The developer's three typed lines, the card's # Copy once chained with &&.
// Three prompts rather than one chained line: chained, it runs past the 159
// columns of a 1440 px terminal and wraps in the middle of a word.
const DEVELOPER_LINES = [
  `git switch ${BRANCH}`,
  `echo "${README_LINE}" > README.md`,
  `git add README.md && git commit -m "${COMMIT_SUBJECT}" && git push -q && git status`
]
// git prints the commit as "[<branch> <short sha>] subject": keep the branch,
// mask the sha.
const COMMIT_SHA_MASK = [/\[(\S+) [0-9a-f]{7,40}\]/, '[$1 <sha>]']
// What the release job's log prints that moves from one run to the next and
// is not the card's subject (JOB_LOG_MASKS already covers 8+ hex SHAs, the
// runner and the ids): the tool versions Renovate bumps, how long uv took, and
// git's 7-character short SHAs. 0.1.0 and 0.2.0 stay readable.
const RELEASE_LOG_MASKS = [
  [/commitizen==\d+\.\d+\.\d+/g, 'commitizen==<version>'],
  [/--python \d+\.\d+/g, '--python <version>'],
  [/Installed \d+ packages? in [0-9.]+m?s/g, 'Installed <n> packages in <t>'],
  [/\[detached HEAD [0-9a-f]{7,40}\]/g, '[detached HEAD <sha>]'],
  [/\b[0-9a-f]{7,40}\.\.[0-9a-f]{7,40}\b/g, '<sha>..<sha>']
]
// The runner mask of gitlabCard ("#113 (7ulK8s5G)") also matches an issue
// reference with its state, "#1 (closed)", in the merge details of a merged
// merge request. A no-break space keeps the words as GitLab wrote them.
// ponytail: local dodge until the runner mask is narrowed in gitlabCard.js.
const ISSUE_REF_KEEP = [/#(\d+) \((closed|open)\)/g, '#$1\u00a0($2)']
// Commitizen dates the new CHANGELOG entry with the day it runs.
const CHANGELOG_DATE_MASK = [/\b\d{4}-\d{2}-\d{2}\b/g, '<date>']

const projectApi = (path) => `${BASE_URL}/api/v4/projects/${encodedProjectPath(PROJECT_NAME)}${path}`
const lambdaHeaders = () => ({ 'PRIVATE-TOKEN': global.dailyProject.token })

// CodeceptJS Before/After hooks are GLOBAL: they fire for EVERY scenario the
// worker runs, not just this file's. Guard both by tag.
const ownsScenario = (test) => Boolean(test && test.tags && test.tags.includes('@daily-contribution'))

Before((test) => {
  if (!ownsScenario(test)) return
  global.dailyProject = null
  global.dailyRenderDir = null
  global.dailyRunner = null
  global.dailyContainer = null
  global.dailyMrIid = null
  global.dailyMainPid = null
})

After(async (test) => {
  if (!ownsScenario(test)) return
  // Surgical: unregister ONLY this story's runner token (never --all-runners),
  // so a story sharing the compose service locally keeps its own.
  if (global.dailyRunner) {
    try { await teardownScopedRunner(global.dailyRunner, await getRootHeaders()) } catch (_) {}
    global.dailyRunner = null
  }
  if (global.dailyContainer) {
    try { teardownJourneyTerminal(global.dailyContainer) } catch (_) {}
    global.dailyContainer = null
  }
  // The project and the lambda token that published it.
  if (global.dailyProject) {
    await global.dailyProject.teardown()
    global.dailyProject = null
  }
  if (global.dailyRenderDir) {
    try { fs.rmSync(global.dailyRenderDir, { recursive: true, force: true }) } catch (_) {}
    global.dailyRenderDir = null
  }
})

// ============================================
// Chapter 1: an issue starts the work
// ============================================

// A Maintainer project access token stored, masked, as the CI/CD variable of the
// same name: the release job reads TASK_COMMITIZEN_TOKEN, the feedback job
// TASK_RENOVATE_TOKEN, exactly as `task devsecops:init` wires them
// (.config/glab/project-token.sh). Masked, so GitLab hides it from every log.
async function wireAutomationVariable (name, rootHeaders) {
  const expires = new Date(Date.now() + 300 * 86400000).toISOString().slice(0, 10)
  const tok = await createProjectAccessToken(
    PROJECT_NAME, { name, scopes: ['api', 'write_repository'], access_level: 40, expires_at: expires }, rootHeaders
  )
  if (tok.status >= 400) throw new Error(`Failed to create token ${name} (status ${tok.status}): ${JSON.stringify(tok.data)}`)
  const v = await createProjectVariable(PROJECT_NAME, { key: name, value: tok.data.token, masked: true }, rootHeaders)
  if (v.status >= 400) throw new Error(`Failed to store CI/CD variable ${name} (status ${v.status}): ${JSON.stringify(v.data)}`)
}

// The scaffold push is published with ci.skip, so its pipeline can never run
// once the runner is registered, and GitLab still records it as "skipped".
// Delete that record: its status icon would sit on the scaffold commit.
async function deleteScaffoldPipeline (rootHeaders) {
  for (let i = 0; i < 30; i++) {
    const pipes = (await listProjectPipelines(PROJECT_NAME, rootHeaders)).data || []
    if (pipes.length) {
      for (const p of pipes) await deletePipeline(PROJECT_NAME, p.id, rootHeaders)
      return
    }
    await I.wait(2)
  }
  throw new Error('The scaffold push never recorded its pipeline')
}

// The whole off-camera stage in one sentence, closed by its visual proof: a
// vanilla GENERATED project (copier render at VERSION 0.1.0, whose release
// stamps a deterministic 0.2.0, never the toolbox's own moving version) on its
// main branch, its automation tokens wired, fast-forward merges, and this
// story's runner registered, so the merge request pipeline starts the moment
// the developer pushes.
storyboardStep(Given, 'an installed project with the framework already on its main branch', async () => {
  const rootHeaders = await getRootHeaders()
  await GitLabProjectPage.deleteProjectIfExists(
    BASE_URL,
    process.env.TASK_GITLAB_ROOT_USER,
    process.env.TASK_GITLAB_ROOT_PASSWORD,
    projectPath(PROJECT_NAME)
  )
  // The developer works signed in. The login also makes sure the lambda user
  // exists before a token is made for it.
  await GitLabUserPage.loginAs(process.env.TASK_GITLAB_LAMBDA_USER, process.env.TASK_GITLAB_LAMBDA_PASSWORD)
  global.dailyRenderDir = renderProject()
  global.dailyProject = await publishToGitLab(global.dailyRenderDir, {
    name: PROJECT_NAME,
    message: SCAFFOLD_COMMIT,
    pushOptions: ['ci.skip']
  })
  await wireAutomationVariable('TASK_COMMITIZEN_TOKEN', rootHeaders)
  await wireAutomationVariable('TASK_RENOVATE_TOKEN', rootHeaders)
  // Fast-forward merges, so the change joins the main branch as a straight
  // line, the way the toolbox configures a real project.
  await updateProjectSettings(PROJECT_NAME, { merge_method: 'ff', remove_source_branch_after_merge: true }, rootHeaders)
  await deleteScaffoldPipeline(rootHeaders)
  global.dailyRunner = await registerScopedRunner(I, PROJECT_NAME, rootHeaders)

  await gitlabFrame(I, 'installed-project', gitlabUrl.tree(PROJECT_NAME), { waitText: SCAFFOLD_COMMIT, height: 1100 })
  // Twin: the main branch carries the framework a fresh install ships, and no
  // README yet (the template leaves it to the project).
  const tree = await listRepositoryTree(PROJECT_NAME, rootHeaders, '?ref=main&per_page=100')
  const names = (tree.data || []).map(e => e.name)
  for (const f of ['Taskfile.yml', '.gitlab-ci.yml', '.config', '.agents', '.claude', 'VERSION']) {
    if (!names.includes(f)) throw new Error(`Expected the main branch to carry "${f}". Entries: ${JSON.stringify(names)}`)
  }
  if (names.includes('README.md')) throw new Error('Expected no README.md on the main branch before the change')
})

// GitLab takes a new branch in on a background job. If a merge request from
// that branch already exists when the job starts, the job adds "restored source
// branch" to the merge request's activity. The job records the push event only
// after it has made that choice, so once the event is there no merge request
// opened later can get the note.
async function waitBranchTakenIn () {
  for (let i = 0; i < 30; i++) {
    if (i) await I.wait(2)
    const events = (await freshGet(projectApi('/events?action=pushed'), lambdaHeaders())).data || []
    if (events.some(e => e.push_data && e.push_data.ref === BRANCH)) return
  }
  throw new Error(`GitLab never recorded the push event of the new branch ${BRANCH}`)
}

// Mirror the issue page's "Create merge request" button, as the developer (the
// lambda user, never the admin): a branch named after the ticket, a merge
// request that closes it, assigned to its author.
storyboardStep(When, 'the developer opens an issue and creates its merge request, assigned to themself', async () => {
  const rootHeaders = await getRootHeaders()
  const issue = await createProjectIssue(
    PROJECT_NAME,
    { title: ISSUE_TITLE, description: 'Add a short line to the README so newcomers know the project runs on the DevSecOps Toolbox.' },
    lambdaHeaders()
  )
  if (issue.status >= 400) throw new Error(`Failed to open the issue (status ${issue.status}): ${JSON.stringify(issue.data)}`)
  if (issue.data.state !== 'opened') throw new Error(`Expected the issue open, got state=${issue.data.state}`)
  const branch = await createRepositoryBranch(PROJECT_NAME, BRANCH, 'main', lambdaHeaders())
  if (branch.status >= 400) throw new Error(`Failed to create branch "${BRANCH}" (status ${branch.status}): ${JSON.stringify(branch.data)}`)
  await waitBranchTakenIn()
  const mr = await createMergeRequest(
    PROJECT_NAME,
    {
      source_branch: BRANCH,
      target_branch: 'main',
      title: `Resolve "${ISSUE_TITLE}"`,
      description: `Closes #${issue.data.iid}`,
      assignee_id: await getLambdaUserId(rootHeaders),
      remove_source_branch: true
    },
    lambdaHeaders()
  )
  if (mr.status >= 400) throw new Error(`Failed to open the merge request (status ${mr.status}): ${JSON.stringify(mr.data)}`)
  global.dailyMrIid = mr.data.iid
  // GitLab links "Closes #N" to the issue asynchronously: until it has, the
  // sidebar files the issue under "Mentioned" rather than "Closing". Waiting for
  // the link is also the plainest proof that this merge request closes it.
  let closing = []
  for (let i = 0; i < 30 && !closing.length; i++) {
    if (i) await I.wait(2)
    closing = (await freshGet(projectApi(`/merge_requests/${global.dailyMrIid}/closes_issues`), lambdaHeaders())).data || []
  }
  if (!closing.some(c => c.iid === issue.data.iid)) throw new Error('Expected the merge request to be closing the issue')

  // The whole page as GitLab fills it: the widget's verdict on a merge request
  // with no commit yet, the activity's "assigned to" note, and the sidebar's
  // "Closing" work item, each waited for.
  await gitlabFrame(I, 'mr-from-issue', gitlabUrl.mr(PROJECT_NAME, global.dailyMrIid), {
    waitText: 'Merge request contains no changes',
    prepare: async () => {
      await I.waitForText(`assigned to @${process.env.TASK_GITLAB_LAMBDA_USER}`, 30)
      await I.waitForText('Closing', 30)
    }
  })
  // Twin: the MR is open, on its own branch, targeting main, taken by its author.
  if (mr.data.state !== 'opened') throw new Error(`Expected the MR open, got state=${mr.data.state}`)
  if (mr.data.source_branch !== BRANCH || mr.data.target_branch !== 'main') {
    throw new Error(`Expected MR ${BRANCH} -> main, got ${mr.data.source_branch} -> ${mr.data.target_branch}`)
  }
  const assignee = mr.data.assignee && mr.data.assignee.username
  if (assignee !== process.env.TASK_GITLAB_LAMBDA_USER) throw new Error(`Expected the MR assigned to the developer, got ${assignee}`)
})

// ============================================
// Chapter 2: the change rides a merge request
// ============================================

// A live terminal on the developer's clone (taken off camera, now that the
// issue's branch exists), 1440 px wide so the longest typed line fits on one
// row. The card is the whole session since the screen was cleared: the three
// typed lines and git's answers. The clone's origin carries the token, so
// nothing secret is typed or printed.
storyboardStep(When, "the developer writes a one-line README on the issue's branch, commits it as a conventional feat and pushes it", async () => {
  global.dailyContainer = setupClonedProjectTerminal(PROJECT_NAME, global.dailyProject.token)
  await openTerminal(I, global.dailyContainer, { width: 1440, height: 600 })
  await clearTerminal(I)
  for (const line of DEVELOPER_LINES) await typeCommandAndWait(I, line)
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'conventional-commit', {
    fromMarker: DEVELOPER_LINES[0],
    mask: [COMMIT_SHA_MASK]
  }))
  // Twins: git's own answers on screen, then GitLab's copy of the branch.
  const screen = await terminalScreenText(I)
  for (const said of [`[${BRANCH} `, 'create mode 100644 README.md', `Your branch is up to date with 'origin/${BRANCH}'.`]) {
    if (!screen.includes(said)) throw new Error(`Expected git to say "${said}":\n${screen}`)
  }
  const head = ((await listProjectBranches(PROJECT_NAME, lambdaHeaders())).data || []).find(b => b.name === BRANCH)
  if (!head || head.commit.title !== COMMIT_SUBJECT) {
    throw new Error(`Expected "${COMMIT_SUBJECT}" on top of ${BRANCH} on GitLab, got ${head && head.commit.title}`)
  }
  const readme = String(await getRepositoryFile(PROJECT_NAME, 'README.md', BRANCH, lambdaHeaders())).trim()
  if (readme !== README_LINE) throw new Error(`Expected README.md on ${BRANCH} to be the one line, got:\n${readme}`)
})

// The Changes tab once GitLab has taken the push in: the merge request holds the
// one commit and its pipeline exists, so the tab counters are final.
storyboardStep(Then, 'the merge request shows that one-line change', async () => {
  const mrPath = `/merge_requests/${global.dailyMrIid}`
  let commits = []
  let pipelines = []
  let diffs = []
  for (let i = 0; i < 30; i++) {
    if (i) await I.wait(2)
    commits = (await freshGet(projectApi(`${mrPath}/commits`), lambdaHeaders())).data || []
    pipelines = (await freshGet(projectApi(`${mrPath}/pipelines`), lambdaHeaders())).data || []
    diffs = (await freshGet(projectApi(`${mrPath}/diffs`), lambdaHeaders())).data || []
    if (commits.length === 1 && pipelines.length && diffs.length) break
  }
  // Twin: one commit, one pipeline, one new file whose diff is the one line.
  if (commits.length !== 1 || commits[0].title !== COMMIT_SUBJECT) {
    throw new Error(`Expected the merge request to hold the one feat commit, got: ${commits.map(c => c.title).join(', ') || 'none'}`)
  }
  if (pipelines.length !== 1) throw new Error(`Expected exactly one merge request pipeline, got ${pipelines.length}`)
  if (diffs.length !== 1 || diffs[0].new_path !== 'README.md' || !diffs[0].new_file || !diffs[0].diff.includes(`+${README_LINE}`)) {
    throw new Error(`Expected the merge request to add README.md and only it, got: ${JSON.stringify(diffs.map(d => d.new_path))}`)
  }

  await gitlabFrame(I, 'mr-changes', gitlabUrl.mr(PROJECT_NAME, global.dailyMrIid, 'diffs'), {
    height: 480,
    prepare: async () => {
      // GitLab can serve an empty diff while its file tree already lists the
      // path: reload that stale view until the line itself is drawn.
      for (let i = 0; i < 12; i++) {
        if (await I.executeScript((text) => document.body.innerText.includes(text), README_LINE)) break
        await I.wait(5)
        await I.refreshPage()
      }
      await I.waitForText(README_LINE, 10)
      // GitLab folds the file tree for a one-file diff: open it, the tree is
      // part of what a reviewer reads.
      await I.executeScript(() => {
        if (document.querySelector('[data-testid="file-tree-container"], .diff-tree-list, [class*="tree-list-holder"]')) return
        const toggle = Array.from(document.querySelectorAll('button')).find(b =>
          /file browser|file tree|hide files|show files/i.test(`${b.getAttribute('aria-label') || ''} ${b.title || ''}`))
        if (toggle) toggle.click()
      })
    }
  })
})

// ============================================
// Chapter 3: the main branch releases it
// ============================================

// Every job of the merge request pipeline green, the merge by the developer,
// the source branch gone, then the main branch's own pipeline run to its end
// before the card is taken: the merged page then shows both pipelines in a
// final state, never one mid-run.
async function assertMergeRequestPipelineGreen (rootHeaders, svc) {
  const mrPipeline = await waitMergeRequestPipeline(I, PROJECT_NAME, global.dailyMrIid, rootHeaders)
  const mrJobs = mrPipeline.pid ? ((await listPipelineJobs(PROJECT_NAME, mrPipeline.pid, rootHeaders)).data || []) : []
  if (mrPipeline.status !== 'success') {
    dumpFailedTraces(PROJECT_NAME, mrJobs, rootHeaders, svc)
    throw new Error(`Expected the merge request pipeline to pass, got status=${mrPipeline.status}`)
  }
  const notGreen = mrJobs.filter(j => j.status !== 'success').map(j => j.name + '=' + j.status)
  if (!mrJobs.length || notGreen.length) {
    throw new Error(`Expected every job green (${mrJobs.length} jobs), not: ${notGreen.join(', ') || 'none'}`)
  }
}

async function mergeAndWaitForBranchDeletion (rootHeaders) {
  const merged = await mergeMergeRequest(PROJECT_NAME, global.dailyMrIid, lambdaHeaders())
  let state = merged.data && merged.data.state
  for (let i = 0; i < 15 && state !== 'merged'; i++) {
    await I.wait(2)
    state = ((await getMergeRequest(PROJECT_NAME, global.dailyMrIid, rootHeaders)).data || {}).state
  }
  if (state !== 'merged') throw new Error(`Expected the MR merged, got state=${state}`)
  // GitLab deletes the source branch in a background job: until it ran, the
  // page still offers "Delete source branch".
  let branches = []
  for (let i = 0; i < 30; i++) {
    branches = ((await listProjectBranches(PROJECT_NAME, rootHeaders)).data || []).map(b => b.name)
    if (!branches.includes(BRANCH)) break
    await I.wait(2)
  }
  if (branches.includes(BRANCH)) throw new Error(`Expected the source branch ${BRANCH} to be deleted by the merge`)
}

async function assertMainPipelineGreen (rootHeaders, svc) {
  const main = await waitRefPipeline(I, PROJECT_NAME, 'main', rootHeaders)
  global.dailyMainPid = main.pid
  if (main.status !== 'success') {
    const jobs = main.pid ? ((await listPipelineJobs(PROJECT_NAME, main.pid, rootHeaders)).data || []) : []
    dumpFailedTraces(PROJECT_NAME, jobs, rootHeaders, svc)
    throw new Error(`Expected the main branch pipeline to pass, got status=${main.status} (pipeline ${main.pid})`)
  }
}

storyboardStep(When, "the merge request's pipeline passes and the developer merges it into the main branch", async () => {
  const rootHeaders = await getRootHeaders()
  const svc = global.dailyRunner && global.dailyRunner.svc
  await assertMergeRequestPipelineGreen(rootHeaders, svc)
  await mergeAndWaitForBranchDeletion(rootHeaders)
  await assertMainPipelineGreen(rootHeaders, svc)

  await gitlabFrame(I, 'merged-into-main', gitlabUrl.mr(PROJECT_NAME, global.dailyMrIid), {
    waitText: 'Deleted the source branch',
    hide: ['ul.main-notes-list'],
    textMasks: [ISSUE_REF_KEEP]
  })
  // Twins: the change is on the main branch and the issue is closed.
  const readme = String(await getRepositoryFile(PROJECT_NAME, 'README.md', 'main', rootHeaders)).trim()
  if (readme !== README_LINE) throw new Error(`Expected README.md on the main branch to be the one line, got:\n${readme}`)
  const issue = (await freshGet(projectApi('/issues/1'), rootHeaders)).data || {}
  if (issue.state !== 'closed') throw new Error(`Expected issue #1 closed by the merge, got state=${issue.state}`)
})

// The release job's own page and log, from the Commitizen run to the end of the
// job. Twin: the raw trace says the same, and the job is the main pipeline's.
storyboardStep(Then, 'the release job on the main branch moves the version from 0.1.0 to 0.2.0', async () => {
  const rootHeaders = await getRootHeaders()
  const jobs = (await listPipelineJobs(PROJECT_NAME, global.dailyMainPid, rootHeaders)).data || []
  const release = jobs.find(j => j.name === 'release' || j.stage === 'release')
  if (!release) throw new Error(`Expected a release job in the main branch pipeline, got: ${jobs.map(j => `${j.stage}/${j.name}`).join(', ')}`)
  if (release.status !== 'success' || release.ref !== 'main') {
    throw new Error(`Expected the release job green on main, got ${release.status} on ${release.ref}`)
  }
  const trace = String(await getJobTrace(PROJECT_NAME, release.id, rootHeaders))
  const said = [
    'increment detected: MINOR', BUMP_SUBJECT, 'tag to create: 0.2.0',
    'Pushing tags and the version commit to main', 'Default branch protection restored (push=No one).', 'Job succeeded'
  ]
  for (const line of said) {
    if (!trace.includes(line)) throw new Error(`Expected the release log to say "${line}"`)
  }
  if (!/\[new tag\]\s+0\.2\.0 -> 0\.2\.0/.test(trace)) throw new Error('Expected the release log to push the new tag 0.2.0')
  // The cache upload and the after_script (the re-lock safety net, already
  // done by the release itself) stay folded under their headers, so the
  // card reaches "Job succeeded".
  await jobLogFrame(I, 'release-log', PROJECT_NAME, release.id, {
    from: 'Running Commitizen version bump',
    fold: ['Running after_script', 'Saving cache for successful job'],
    masks: RELEASE_LOG_MASKS,
    height: 1100
  })
})

// The release commit's own page: the tag GitLab holds on it, and its diff of
// the three files it moved. The page runs past the 1100 px of a card, so it is
// scrolled down to the commit title (GitLab keeps the breadcrumb pinned above
// it): the last diff, VERSION, then fits whole.
storyboardStep(Then, 'the release commit is tagged 0.2.0 and moves VERSION, the Commitizen config and the CHANGELOG to 0.2.0', async () => {
  const rootHeaders = await getRootHeaders()
  // Twin: one tag, plain semver with no v prefix, on the release commit.
  const tags = (await listProjectTags(PROJECT_NAME, rootHeaders)).data || []
  if (tags.length !== 1 || tags[0].name !== '0.2.0' || tags[0].commit.title !== BUMP_SUBJECT) {
    throw new Error(`Expected the one tag 0.2.0 on "${BUMP_SUBJECT}", got: ${JSON.stringify(tags.map(t => [t.name, t.commit.title]))}`)
  }
  const main = ((await listProjectBranches(PROJECT_NAME, rootHeaders)).data || []).find(b => b.name === 'main')
  if (!main || main.commit.title !== BUMP_SUBJECT) throw new Error(`Expected the main branch on "${BUMP_SUBJECT}", got ${main && main.commit.title}`)
  // Twins: exactly these three files, and what they now say on the main branch.
  const diff = (await freshGet(projectApi(`/repository/commits/${main.commit.id}/diff`), rootHeaders)).data || []
  const paths = diff.map(d => d.new_path).sort()
  const expected = ['.config/commitizen/cz.yaml', 'CHANGELOG.md', 'VERSION']
  if (JSON.stringify(paths) !== JSON.stringify(expected)) {
    throw new Error(`Expected the release commit to change ${JSON.stringify(expected)}, got ${JSON.stringify(paths)}`)
  }
  const version = String(await getRepositoryFile(PROJECT_NAME, 'VERSION', 'main', rootHeaders)).trim()
  if (version !== '0.2.0') throw new Error(`Expected VERSION 0.2.0 on the main branch, got "${version}"`)
  const cz = String(await getRepositoryFile(PROJECT_NAME, '.config/commitizen/cz.yaml', 'main', rootHeaders))
  if (!/^\s*version: 0\.2\.0$/m.test(cz)) throw new Error(`Expected cz.yaml at version 0.2.0:\n${cz}`)
  const changelog = String(await getRepositoryFile(PROJECT_NAME, 'CHANGELOG.md', 'main', rootHeaders))
  if (!changelog.includes('## 0.2.0') || !changelog.includes('mention the toolbox in the readme')) {
    throw new Error(`Expected a 0.2.0 CHANGELOG entry listing the feat:\n${changelog}`)
  }

  await gitlabFrame(I, 'release-commit', gitlabUrl.commit(PROJECT_NAME, main.commit.id), {
    waitText: 'CHANGELOG.md',
    height: 1100,
    textMasks: [CHANGELOG_DATE_MASK],
    // GitLab lists the branches and tags holding the commit once the page is up.
    prepare: () => I.waitForFunction(() => /Branches\s*main/.test(document.body.innerText) &&
      /Tags\s*0\.2\.0/.test(document.body.innerText), 30),
    scrollTo: async () => {
      await I.executeScript((subject) => {
        const title = Array.from(document.querySelectorAll('main *')).filter(el => el.textContent.trim() === subject).pop()
        if (!title) throw new Error(`No commit title "${subject}" on the page`)
        title.scrollIntoView({ block: 'start' })
        let box = title.parentElement
        while (box && box !== document.body &&
          !(box.scrollHeight > box.clientHeight && /(auto|scroll)/.test(window.getComputedStyle(box).overflowY))) box = box.parentElement
        ;(box && box !== document.body ? box : document.scrollingElement).scrollBy(0, -16)
      }, BUMP_SUBJECT)
      await settlePage(I, { quietMs: 300 })
    }
  })
})
