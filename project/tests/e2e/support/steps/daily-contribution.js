/* global inject Given When Then Before After */
/**
 * Daily-contribution storyboard — @daily-contribution, on its own shard.
 *
 * A project the installer already set up gets one everyday change and carries
 * it the way a human developer does: the issue first, the merge request
 * created from it and self-assigned, a fresh clone in a workspace folder named
 * after the project's address, one README line, a conventional `feat:` commit
 * pushed on the issue's branch, the merge request's pipeline going green, the
 * merge into main, main's OWN pipeline running the release stage, the proof in
 * the job log / the tags page / the files — and finally the local clone
 * deleted, because GitLab holds everything. The developer stays signed in on
 * every GitLab page. ONE Gherkin sentence = ONE card = ONE pixel baseline,
 * asserted inside the step (tolerance: 0); each GitLab page is masked for its
 * volatile chrome and each terminal card is a real <pre> of the git output,
 * both twinned with a REST/git check of the same fact.
 *
 * The real MR and main pipelines run on a project-scoped runner registered
 * inside the shared gitlab-runner compose service; concurrent=1 serialises
 * this story's jobs with @install-complete's when the full suite runs locally,
 * and the runner is torn down surgically (its own token only) so neither
 * scenario disturbs the other. See support/helpers/pipelineRunner.js.
 */
const fs = require('fs')
const { execSync } = require('child_process')
const { I, GitLabProjectPage, GitLabRepositoryPage, GitLabMergeRequestPage, GitLabUserPage } = inject()
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
  updateProjectSettings,
  listRepositoryTree,
  listProjectPipelines,
  listPipelineJobs,
  cancelPipeline,
  deletePipeline,
  getLambdaUserId,
  createProjectIssue,
  createRepositoryBranch,
  createMergeRequest,
  getMergeRequest,
  mergeMergeRequest,
  listProjectBranches,
  listProjectTags
} = require('../helpers/gitlabApi')
const {
  registerScopedRunner,
  teardownScopedRunner,
  waitMergeRequestPipeline,
  waitRefPipeline,
  dumpFailedTraces,
  maskPipelinePage
} = require('../helpers/pipelineRunner')
const { runTaskInRepo } = require('../helpers/workspaceRepo')
const { freshGet } = require('../helpers/http')
const { runCommandWithResult } = require('../helpers/docker')
const { renderProject } = require('../helpers/copierRender')
const { storyboardStep, addStoryboardFrame, capturePageFrame } = require('../../../../../.config/codeceptjs/storyboard')
const { renderPreFrame, stripAnsi } = require('../helpers/capturedOutput')

const PROJECT_NAME = 'e2e-daily-contribution'
const ISSUE_TITLE = 'Mention the toolbox in the README'
// The branch GitLab's "Create merge request" button would open from issue #1.
const BRANCH = '1-mention-the-toolbox-in-the-readme'
const README_LINE = 'This project was scaffolded with The DevSecOps Toolbox.'
const COMMIT_SUBJECT = 'feat: mention the toolbox in the readme'

// Every command of the developer's session runs where the card says it runs: a
// workspace folder named after the project's address, exactly the layout a
// real developer keeps (~/workspace/gitlab/<user>/<project>). The session gets
// its OWN $HOME: the shared /root home is a thoroughfare for the other
// parallel scenarios (something there deleted this clone mid-run, full-suite
// only), and `~` on the cards resolves against the developer's home wherever
// they are — an isolated one included.
const DAILY_HOME = '/tmp/e2e-daily-home'
function workspaceHome () {
  return `${DAILY_HOME}/workspace`
}
function lambdaUser () {
  return process.env.TASK_GITLAB_LAMBDA_USER
}
function cloneDir () {
  return `${workspaceHome()}/gitlab/${lambdaUser()}/${PROJECT_NAME}`
}

function sh (cmd, cwd) {
  // A vanished cwd makes execSync die with the opaque "spawnSync /bin/sh
  // ENOENT" — name the real culprit instead.
  if (cwd && !fs.existsSync(cwd)) {
    throw new Error(`sh(): working directory is gone: ${cwd} (command: ${cmd})`)
  }
  try {
    return stripAnsi(execSync(`${cmd} 2>&1`, {
      cwd,
      env: { ...process.env, HOME: DAILY_HOME },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
      encoding: 'utf8'
    })).trimEnd()
  } catch (error) {
    const out = stripAnsi(`${error.stdout || ''}${error.stderr || ''}`).trim()
    throw new Error(`sh() failed in ${cwd || '(inherited cwd)'}: ${cmd}\n${out || error.message}`)
  }
}

// git prints the commit as "[<branch> <short sha>] subject" — keep the branch
// (it tells the story), mask the sha.
function maskSha (out) {
  return out.replace(/\[([^\]]+) [0-9a-f]{7,}\]/g, '[$1 <sha>]')
}

// CodeceptJS Before/After hooks are GLOBAL: they fire for EVERY scenario the
// worker runs, not just this file's. Unguarded, this After's clone cleanup
// (a FIXED path) executed whenever ANOTHER story finished on a parallel
// worker — deleting the daily clone mid-scenario. Guard both hooks by tag.
const ownsScenario = (test) => Boolean(test && test.tags && test.tags.includes('@daily-contribution'))

Before((test) => {
  if (!ownsScenario(test)) return
  global.dailyProject = null
  global.dailyRenderDir = null
  global.dailyGlabToken = null
  global.dailyTokenId = null
  global.dailyIssueIid = null
  global.dailyMrIid = null
  global.dailyRunner = null
  global.dailyMainPid = null
})

After(async (test) => {
  if (!ownsScenario(test)) return
  // Surgical: unregister ONLY this story's runner token (never --all-runners)
  // so @install-complete, which shares the compose service locally, is
  // untouched.
  if (global.dailyRunner) {
    try {
      const rootHeaders = await getRootHeaders()
      await teardownScopedRunner(global.dailyRunner, rootHeaders)
    } catch (_) {}
    global.dailyRunner = null
  }
  if (global.dailyProject) {
    try {
      const rootHeaders = await getRootHeaders()
      await deleteProject(global.dailyProject, rootHeaders)
    } catch (_) {}
    global.dailyProject = null
  }
  if (global.dailyTokenId) {
    try {
      const rootHeaders = await getRootHeaders()
      await revokePersonalAccessToken(global.dailyTokenId, rootHeaders)
    } catch (_) {}
    global.dailyTokenId = null
  }
  if (global.dailyRenderDir) {
    try { fs.rmSync(global.dailyRenderDir, { recursive: true, force: true }) } catch (_) {}
    global.dailyRenderDir = null
  }
  try { fs.rmSync(cloneDir(), { recursive: true, force: true }) } catch (_) {}
})

// ============================================
// Chapter 1 — an issue starts the work
// ============================================

// Create a Maintainer project access token and store it as the CI/CD variable of
// the same name — the release job reads TASK_COMMITIZEN_TOKEN, the feedback job
// TASK_RENOVATE_TOKEN, exactly as `task devsecops:init` wires them. (init itself
// only bootstraps a README on main and delivers the framework through an MR, so
// this story installs the render straight to main instead.)
async function wireAutomationVariable (projectName, name, rootHeaders) {
  const expires = new Date(Date.now() + 300 * 86400000).toISOString().slice(0, 10)
  const tok = await createProjectAccessToken(
    projectName, { name, scopes: ['api', 'write_repository'], access_level: 40, expires_at: expires }, rootHeaders
  )
  if (tok.status >= 400) throw new Error(`Failed to create token ${name} (status ${tok.status}): ${JSON.stringify(tok.data)}`)
  const v = await createProjectVariable(projectName, { key: name, value: tok.data.token }, rootHeaders)
  if (v.status >= 400) throw new Error(`Failed to store CI/CD variable ${name} (status ${v.status}): ${JSON.stringify(v.data)}`)
}

// Push the freshly rendered framework straight to main over a token remote. The
// git output (which echoes the token in the remote URL) is swallowed; the twin
// on the Given proves the push landed. hooksPath is voided so the fixture
// commit is fast and deterministic (protected-commits covers hook enforcement).
function pushFrameworkToMain (repoDir, token) {
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
      'git commit --quiet -m "chore: scaffold the project from the devsecops toolbox"',
      `git remote add origin ${remote}`,
      'git push --quiet -u origin main'
    ].join(' && '), repoDir, token, { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (_) {
    throw new Error('Failed to scaffold and push the framework to main (see runner logs)')
  }
}

// The whole off-camera stage in one sentence, closed by its visual proof: a
// vanilla GENERATED project (copier render at VERSION 0.1.0 — its pipeline is the
// generated ~17-job one, and the release stamps a deterministic 0.2.0, never the
// toolbox's own moving version) pushed to main with its automation tokens wired.
// The fixture push's bootstrap pipeline is deleted right away so the ?ref=main
// pipeline card later shows exactly one pipeline: the release run.
storyboardStep(Given, 'an installed project with the framework already on its main branch', async () => {
  const rootHeaders = await getRootHeaders()
  global.dailyProject = PROJECT_NAME
  await GitLabProjectPage.deleteProjectIfExists(
    BASE_URL,
    process.env.TASK_GITLAB_ROOT_USER,
    process.env.TASK_GITLAB_ROOT_PASSWORD,
    projectPath(PROJECT_NAME)
  )
  const { token, id } = await createLambdaPersonalAccessToken(
    `daily-${PROJECT_NAME}`, ['api', 'write_repository'], rootHeaders
  )
  global.dailyGlabToken = token
  global.dailyTokenId = id
  const created = await createProject(
    { name: PROJECT_NAME, visibility: 'public', initialize_with_readme: false },
    { 'PRIVATE-TOKEN': token }
  )
  if (created.status >= 400) {
    throw new Error(`Failed to create project "${PROJECT_NAME}" (status ${created.status}): ${JSON.stringify(created.data)}`)
  }
  const repoDir = renderProject()
  global.dailyRenderDir = repoDir
  pushFrameworkToMain(repoDir, token)
  await wireAutomationVariable(PROJECT_NAME, 'TASK_COMMITIZEN_TOKEN', rootHeaders)
  await wireAutomationVariable(PROJECT_NAME, 'TASK_RENOVATE_TOKEN', rootHeaders)
  // Fast-forward merges so the change joins main as a straight line, the way the
  // toolbox configures a real project.
  await updateProjectSettings(PROJECT_NAME, { merge_method: 'ff', remove_source_branch_after_merge: true }, rootHeaders)
  // Cancel AND delete the fixture push's pipeline: without a runner it would
  // sit pending forever, and its row would pollute the release-pipeline card.
  try {
    const pipes = await listProjectPipelines(PROJECT_NAME, rootHeaders)
    for (const p of (pipes.data || [])) {
      await cancelPipeline(PROJECT_NAME, p.id, rootHeaders)
      await deletePipeline(PROJECT_NAME, p.id, rootHeaders)
    }
  } catch (_) {}

  // The developer works signed in — every GitLab card of this story shows the
  // project as its author sees it.
  await GitLabUserPage.loginAs(process.env.TASK_GITLAB_LAMBDA_USER, process.env.TASK_GITLAB_LAMBDA_PASSWORD)

  I.resizeWindow(1024, 640)
  await I.amOnPage(`/${projectPath(PROJECT_NAME)}`)
  await GitLabRepositoryPage.maskVolatile(PROJECT_NAME)
  await addStoryboardFrame(I, await capturePageFrame(I, 'installed-project'))
  I.resizeWindow(1024, 768)
  // Twin: main really carries the framework a fresh install ships.
  const tree = await listRepositoryTree(PROJECT_NAME, rootHeaders, '?ref=main&per_page=100')
  const names = (tree.data || []).map(e => e.name)
  for (const f of ['Taskfile.yml', '.gitlab-ci.yml', '.config']) {
    if (!names.includes(f)) throw new Error(`Expected main to carry "${f}". Entries: ${JSON.stringify(names)}`)
  }
})

storyboardStep(When, 'the developer opens an issue for a small change', async () => {
  // The developer (lambda), not the admin: the card must show the author a
  // real project would show.
  const lambdaHeaders = { 'PRIVATE-TOKEN': global.dailyGlabToken }
  const issue = await createProjectIssue(
    PROJECT_NAME,
    { title: ISSUE_TITLE, description: 'Add a short line to the README so newcomers know the project runs on the DevSecOps Toolbox.' },
    lambdaHeaders
  )
  if (issue.status >= 400) throw new Error(`Failed to open the issue (status ${issue.status}): ${JSON.stringify(issue.data)}`)
  global.dailyIssueIid = issue.data.iid
  I.resizeWindow(1024, 640)
  await I.amOnPage(`/${projectPath(PROJECT_NAME)}/-/issues/${global.dailyIssueIid}`)
  await GitLabRepositoryPage.maskVolatile(PROJECT_NAME)
  await addStoryboardFrame(I, await capturePageFrame(I, 'issue-opened'))
  I.resizeWindow(1024, 768)
  // Twin: the issue is really open.
  if (issue.data.state !== 'opened') throw new Error(`Expected the issue open, got state=${issue.data.state}`)
})

storyboardStep(When, 'the developer creates the merge request from the issue and takes it', async () => {
  const rootHeaders = await getRootHeaders()
  const lambdaHeaders = { 'PRIVATE-TOKEN': global.dailyGlabToken }
  // Mirror the issue page's "Create merge request" button, as the developer: a
  // branch named after the ticket, an MR that closes it, assigned to its
  // author.
  const branch = await createRepositoryBranch(PROJECT_NAME, BRANCH, 'main', lambdaHeaders)
  if (branch.status >= 400) throw new Error(`Failed to create branch "${BRANCH}" (status ${branch.status}): ${JSON.stringify(branch.data)}`)
  const assigneeId = await getLambdaUserId(rootHeaders)
  const mr = await createMergeRequest(
    PROJECT_NAME,
    {
      source_branch: BRANCH,
      target_branch: 'main',
      title: `Resolve "${ISSUE_TITLE}"`,
      description: `Closes #${global.dailyIssueIid}`,
      assignee_id: assigneeId,
      remove_source_branch: true
    },
    lambdaHeaders
  )
  if (mr.status >= 400) throw new Error(`Failed to open the merge request (status ${mr.status}): ${JSON.stringify(mr.data)}`)
  global.dailyMrIid = mr.data.iid
  // GitLab links "Closes #N" to the issue asynchronously: until it has, the
  // sidebar files the issue under "Mentioned" rather than "Closing", and the
  // card catches whichever state the page happened to be in. Waiting for the
  // link is also the plainest proof that this merge request closes the ticket.
  let closing = []
  for (let i = 0; i < 30; i++) {
    const res = await freshGet(
      `${BASE_URL}/api/v4/projects/${encodedProjectPath(PROJECT_NAME)}/merge_requests/${global.dailyMrIid}/closes_issues`,
      lambdaHeaders
    )
    closing = res.data || []
    if (closing.length > 0) break
    await I.wait(2)
  }
  if (closing.length === 0) throw new Error('Expected the merge request to be closing the issue')
  // Wide enough for GitLab to unfold the right sidebar — the card must show
  // the Assignee the developer just took.
  I.resizeWindow(1280, 700)
  await GitLabMergeRequestPage.gotoAndMask(projectPath(PROJECT_NAME), global.dailyMrIid, PROJECT_NAME)
  await addStoryboardFrame(I, await capturePageFrame(I, 'mr-from-issue'))
  I.resizeWindow(1024, 768)
  // Twin: the MR is open, on its own branch, targeting main, taken by its author.
  if (mr.data.state !== 'opened') throw new Error(`Expected the MR open, got state=${mr.data.state}`)
  if (mr.data.source_branch !== BRANCH || mr.data.target_branch !== 'main') {
    throw new Error(`Expected MR ${BRANCH} -> main, got ${mr.data.source_branch} -> ${mr.data.target_branch}`)
  }
  const assignee = mr.data.assignee && mr.data.assignee.username
  if (assignee !== lambdaUser()) throw new Error(`Expected the MR assigned to ${lambdaUser()}, got ${assignee}`)
})

// ============================================
// Chapter 2 — the change rides a merge request
// ============================================

storyboardStep(When, 'the developer clones the project into a fresh workspace folder', async () => {
  const user = lambdaUser()
  const dir = cloneDir()
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(workspaceHome(), { recursive: true })
  sh(`mkdir -p gitlab/${user}/${PROJECT_NAME}`, workspaceHome())
  // Keep only the deterministic first clone line; the remote-counting lines
  // that follow carry object counts and speeds.
  const cloneOut = sh(`git clone http://gitlab/${user}/${PROJECT_NAME}.git .`, dir) // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
    .split('\n').filter(l => l.startsWith('Cloning into'))[0] || ''
  const checkoutOut = sh(`git checkout ${BRANCH}`, dir)
  // Off-camera plumbing a real developer has globally: a git identity, and
  // credentials for pushing (the push URL carries the token; it is never
  // printed on a card).
  sh('git config user.email "lambda@test.local" && git config user.name "Lambda"', dir)
  sh(`git remote set-url --push origin http://${user}:${encodeURIComponent(global.dailyGlabToken)}@gitlab/${user}/${PROJECT_NAME}.git`, dir) // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
  await renderPreFrame(I, 'workspace-clone', [
    '$ cd ~/workspace',
    `$ mkdir -p gitlab/${user}/${PROJECT_NAME}`,
    `$ cd gitlab/${user}/${PROJECT_NAME}`,
    `$ git clone http://gitlab/${user}/${PROJECT_NAME}.git .`, // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
    cloneOut,
    `$ git checkout ${BRANCH}`,
    checkoutOut
  ].join('\n'))
  // Twin: the clone holds the framework and sits on the issue's branch.
  if (!fs.existsSync(`${dir}/Taskfile.yml`)) throw new Error('Expected the clone to carry the framework (no Taskfile.yml)')
  const onBranch = sh('git branch --show-current', dir)
  if (onBranch !== BRANCH) throw new Error(`Expected the clone on ${BRANCH}, got "${onBranch}"`)
})

storyboardStep(When, 'the developer adds the line to the README', async () => {
  const dir = cloneDir()
  sh(`echo "${README_LINE}" >> README.md`, dir)
  const tailOut = sh('tail -1 README.md', dir)
  await renderPreFrame(I, 'readme-edit', [
    `$ echo "${README_LINE}" >> README.md`,
    '$ tail -1 README.md',
    tailOut
  ].join('\n'))
  // Twin: the README now ends with the developer's line.
  if (tailOut !== README_LINE) throw new Error(`Expected the README to end with the added line, got "${tailOut}"`)
})

storyboardStep(When, 'the developer commits the change as a conventional feat', async () => {
  const dir = cloneDir()
  sh('git add README.md', dir)
  const commitOut = maskSha(sh(`git commit -m "${COMMIT_SUBJECT}"`, dir))
  await renderPreFrame(I, 'conventional-commit', [
    '$ git add README.md',
    `$ git commit -m "${COMMIT_SUBJECT}"`,
    commitOut
  ].join('\n'))
  // Twin: the top commit is the conventional feat the release will version.
  const subject = sh("git log --format='%s' -1", dir)
  if (subject !== COMMIT_SUBJECT) throw new Error(`Expected the feat commit on top, got "${subject}"`)
})

storyboardStep(When, 'the developer pushes the branch to GitLab', async () => {
  const dir = cloneDir()
  try {
    // Swallow push output: git echoes the token-embedded push URL on stderr.
    // The twin below fails loud if the branch did not reach GitLab.
    execSync('git push 2>/dev/null', { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'], timeout: 120000 })
  } catch (_) {}
  const remoteSubject = sh(`git log origin/${BRANCH} --format='%s' -1`, dir)
  await renderPreFrame(I, 'push-to-gitlab', [
    '$ git push',
    `$ git log origin/${BRANCH} --format='%s' -1`,
    remoteSubject
  ].join('\n'))
  // Twin: the commit is on the REMOTE branch — the push really landed.
  if (remoteSubject !== COMMIT_SUBJECT) throw new Error(`Expected the feat on origin/${BRANCH}, got "${remoteSubject}"`)
})

storyboardStep(Then, "the merge request's pipeline turns green", async () => {
  const rootHeaders = await getRootHeaders()
  // Register the runner now that the push created the MR pipeline; the wait
  // cancels the still-pending bootstrap pipeline so only the MR one runs.
  global.dailyRunner = await registerScopedRunner(I, PROJECT_NAME, rootHeaders)
  const { pid, status } = await waitMergeRequestPipeline(I, PROJECT_NAME, global.dailyMrIid, rootHeaders)
  const jobs = pid ? ((await listPipelineJobs(PROJECT_NAME, pid, rootHeaders)).data || []) : []
  jobs.sort((a, b) => a.id - b.id)
  if (status !== 'success') {
    console.log(`MR pipeline not green (status=${status}); failed: ${jobs.filter(j => j.status === 'failed').map(j => `${j.stage}/${j.name}`).join(', ') || 'none'}`)
    dumpFailedTraces(PROJECT_NAME, jobs, rootHeaders, global.dailyRunner && global.dailyRunner.svc)
    throw new Error(`Expected the MR pipeline to pass, got status=${status}`)
  }
  const notGreen = jobs.filter(j => j.status !== 'success')
  if (!jobs.length || notGreen.length) {
    throw new Error(`Expected every job green (${jobs.length} jobs), not: ${notGreen.map(j => `${j.name}=${j.status}`).join(', ') || 'none'}`)
  }
  // The merge request itself with its widget on "passed" — the page a developer
  // actually watches; the REST twin above already read every job's real state.
  I.resizeWindow(1024, 900)
  await GitLabMergeRequestPage.gotoAndMask(
    projectPath(PROJECT_NAME), global.dailyMrIid, PROJECT_NAME,
    { hideMergeWidget: false, waitText: 'passed' }
  )
  await addStoryboardFrame(I, await capturePageFrame(I, 'mr-pipeline-green'))
  I.resizeWindow(1024, 768)
})

// ============================================
// Chapter 3 — main releases it
// ============================================

storyboardStep(When, 'the reviewed change merges into main', async () => {
  const rootHeaders = await getRootHeaders()
  const lambdaHeaders = { 'PRIVATE-TOKEN': global.dailyGlabToken }
  const merged = await mergeMergeRequest(PROJECT_NAME, global.dailyMrIid, lambdaHeaders)
  let state = merged.data && merged.data.state
  for (let i = 0; i < 15 && state !== 'merged'; i++) {
    await I.wait(2)
    const mr = await getMergeRequest(PROJECT_NAME, global.dailyMrIid, rootHeaders)
    state = mr.data && mr.data.state
  }
  // Twin FIRST: the green pipeline unblocked the merge, the MR is merged.
  if (state !== 'merged') throw new Error(`Expected the MR merged, got state=${state}`)
  // The merge answers before the branch is gone: GitLab deletes the source
  // branch in a background job, and until that job runs the page still offers a
  // "Delete source branch" button and reads "Did not delete the source branch."
  // Waiting for the branch to actually disappear is both the honest end of the
  // merge and what keeps the card from photographing it half-done.
  let branches = []
  for (let i = 0; i < 30; i++) {
    const listed = await listProjectBranches(PROJECT_NAME, rootHeaders)
    branches = (listed.data || []).map(b => b.name)
    if (!branches.includes(BRANCH)) break
    await I.wait(2)
  }
  if (branches.includes(BRANCH)) throw new Error(`Expected the source branch ${BRANCH} to be deleted by the merge`)
  I.resizeWindow(1024, 900)
  await GitLabMergeRequestPage.gotoAndMaskMerged(projectPath(PROJECT_NAME), global.dailyMrIid, PROJECT_NAME)
  await addStoryboardFrame(I, await capturePageFrame(I, 'merged-into-main'))
  I.resizeWindow(1024, 768)
})

storyboardStep(Then, 'the project home now shows the change on main', async () => {
  const dir = cloneDir()
  // Twin FIRST: main's README really ends with the developer's line.
  sh('git fetch origin main', dir)
  const mainReadme = sh('git show origin/main:README.md', dir)
  if (!mainReadme.includes(README_LINE)) throw new Error('Expected README on main to carry the developer line')
  // The merge starts main's own pipeline, whose release job pushes a
  // `build: bump version …` commit on top of the developer's. The card was
  // photographing whichever of the two happened to be there — a coin flip
  // between two legitimate pages. Wait for main to have finished moving.
  let tip = ''
  for (let i = 0; i < 60; i++) {
    sh('git fetch origin main', dir)
    tip = sh('git log -1 --format=%s origin/main', dir).trim()
    if (/^build: bump version/.test(tip)) break
    await I.wait(5)
  }
  if (!/^build: bump version/.test(tip)) throw new Error(`Expected the release to have bumped main, tip is: ${tip}`)
  I.resizeWindow(1024, 640)
  await I.amOnPage(`/${projectPath(PROJECT_NAME)}`)
  await I.waitForText(COMMIT_SUBJECT, 30)
  await GitLabRepositoryPage.maskVolatile(PROJECT_NAME)
  await addStoryboardFrame(I, await capturePageFrame(I, 'home-after-merge'))
  I.resizeWindow(1024, 768)
})

storyboardStep(Then, "main's own pipeline runs the release", async () => {
  const rootHeaders = await getRootHeaders()
  // The merge fired main's own pipeline; wait it green, then prove the release
  // job is part of what ran.
  const { pid, status } = await waitRefPipeline(I, PROJECT_NAME, 'main', rootHeaders)
  global.dailyMainPid = pid
  const jobs = pid ? ((await listPipelineJobs(PROJECT_NAME, pid, rootHeaders)).data || []) : []
  jobs.sort((a, b) => a.id - b.id)
  if (status !== 'success') {
    console.log(`main pipeline not green (status=${status}, pipeline ${pid})`)
    dumpFailedTraces(PROJECT_NAME, jobs, rootHeaders, global.dailyRunner && global.dailyRunner.svc)
    throw new Error(`Expected main's pipeline to pass, got status=${status}`)
  }
  // Twin: the release job really ran, and green.
  const release = jobs.find(j => j.name === 'release' || j.stage === 'release')
  if (!release) throw new Error(`Expected a release job in main's pipeline, got: ${jobs.map(j => `${j.stage}/${j.name}`).join(', ')}`)
  if (release.status !== 'success') throw new Error(`Expected the release job green, got ${release.status}`)
  // The bump commit the release just pushed starts its OWN pipeline on main
  // (it merely re-validates the code the merge pipeline already proved, and
  // its bump commit is not a feat, so it never releases again). Mid-run it
  // would put a transient row on the card — cancel and delete it so the list
  // shows the one pipeline this sentence is about.
  try {
    const pipes = await listProjectPipelines(PROJECT_NAME, rootHeaders)
    for (const p of (pipes.data || [])) {
      if (p.id !== pid) {
        await cancelPipeline(PROJECT_NAME, p.id, rootHeaders)
        await deletePipeline(PROJECT_NAME, p.id, rootHeaders)
      }
    }
  } catch (_) {}
  I.resizeWindow(1024, 640)
  await I.amOnPage(`/${projectPath(PROJECT_NAME)}/-/pipelines?ref=main`)
  await I.waitForText('Passed', 30)
  await maskPipelinePage(I, PROJECT_NAME)
  await addStoryboardFrame(I, await capturePageFrame(I, 'main-pipeline-release'))
  I.resizeWindow(1024, 768)
})

storyboardStep(Then, "the release job's own log confirms the version move", async () => {
  const rootHeaders = await getRootHeaders()
  const jobs = ((await listPipelineJobs(PROJECT_NAME, global.dailyMainPid, rootHeaders)).data || [])
  const release = jobs.find(j => j.name === 'release' || j.stage === 'release')
  if (!release) throw new Error('Release job disappeared between steps')
  const encoded = encodedProjectPath(PROJECT_NAME)
  const trace = runCommandWithResult(
    `curl -s ${curlAuthFlags(rootHeaders)} '${BASE_URL}/api/v4/projects/${encoded}/jobs/${release.id}/trace'`
  )
  const lines = stripAnsi(trace.stdout || trace.output || '')
    .split('\n')
    // Each CI trace line opens with "<iso-timestamp>Z 01O " — volatile, strip it.
    .map(l => l.replace(/^\S+Z \d+[OE]\+? ?/, '').trim())
    .filter(l => /increment detected|bump: version|tag to create/.test(l))
  // Twin FIRST: the job's own log decided the 0.2.0 release from the feat.
  const joined = lines.join('\n')
  if (!/tag to create: 0\.2\.0/.test(joined) || !/increment detected: MINOR/.test(joined)) {
    throw new Error(`Expected the release log to decide tag 0.2.0 from a MINOR increment, got:\n${joined || '(no matching lines)'}`)
  }
  await renderPreFrame(I, 'release-log', lines.join('\n'))
})

storyboardStep(Then, "GitLab's tags page now shows 0.2.0", async () => {
  const rootHeaders = await getRootHeaders()
  let tags = []
  for (let i = 0; i < 20; i++) {
    const res = await listProjectTags(PROJECT_NAME, rootHeaders)
    tags = (res.data || []).map(t => t.name)
    if (tags.includes('0.2.0')) break
    await I.wait(3)
  }
  // Twin FIRST: the stamped tag is plain semver, no v prefix anywhere.
  if (!tags.includes('0.2.0')) throw new Error(`Expected tag 0.2.0, got: ${tags.join(', ') || 'none'}`)
  if (tags.some(t => /^v\d/.test(t))) throw new Error(`Unexpected v-prefixed tag: ${tags.join(', ')}`)
  I.resizeWindow(1024, 640)
  await I.amOnPage(`/${projectPath(PROJECT_NAME)}/-/tags`)
  await I.waitForText('0.2.0', 30)
  await maskPipelinePage(I, PROJECT_NAME)
  await addStoryboardFrame(I, await capturePageFrame(I, 'release-tag'))
  I.resizeWindow(1024, 768)
})

storyboardStep(Then, 'the project files on main now carry the release', async () => {
  I.resizeWindow(1024, 640)
  await I.amOnPage(`/${projectPath(PROJECT_NAME)}`)
  // The bump commit the release pushed now heads main's tree.
  await I.waitForText('build: bump version', 30)
  await GitLabRepositoryPage.maskVolatile(PROJECT_NAME)
  await addStoryboardFrame(I, await capturePageFrame(I, 'files-on-main'))
  I.resizeWindow(1024, 768)
})

storyboardStep(Then, 'VERSION and the version config really moved to 0.2.0', async () => {
  const dir = cloneDir()
  sh('git fetch origin main', dir)
  const version = sh('git show origin/main:VERSION', dir)
  const diffStat = sh('git diff --stat origin/main~1 origin/main', dir)
  const czVersion = sh("git show origin/main:.config/commitizen/cz.yaml | grep 'version:'", dir)
  // Twin FIRST: the release wrote 0.2.0 into VERSION, and the bump commit
  // touched exactly the files that track the version.
  if (version !== '0.2.0') throw new Error(`Expected VERSION 0.2.0 on main, got "${version}"`)
  if (!/VERSION/.test(diffStat) || !/cz\.yaml/.test(diffStat)) {
    throw new Error(`Expected the bump commit to touch VERSION and cz.yaml, got:\n${diffStat}`)
  }
  await renderPreFrame(I, 'version-in-files', [
    '$ git fetch origin main',
    '$ git show origin/main:VERSION',
    version,
    '$ git diff --stat origin/main~1 origin/main',
    diffStat,
    "$ git show origin/main:.config/commitizen/cz.yaml | grep 'version:'",
    czVersion
  ].join('\n'))
})

storyboardStep(Then, 'the developer removes the local clone, ready to start clean next time', async () => {
  const user = lambdaUser()
  const dir = cloneDir()
  sh(`rm -rf gitlab/${user}/${PROJECT_NAME}`, workspaceHome())
  const lsOut = sh(`ls gitlab/${user}`, workspaceHome())
  // Twin FIRST: the clone is really gone — the next change starts from zero.
  if (fs.existsSync(dir)) throw new Error('Expected the local clone to be deleted')
  if (lsOut !== '') throw new Error(`Expected the workspace folder empty, got "${lsOut}"`)
  await renderPreFrame(I, 'clean-slate', [
    `$ cd ~/workspace && rm -rf gitlab/${user}/${PROJECT_NAME}`,
    `$ ls gitlab/${user}`
  ].join('\n'))
})
