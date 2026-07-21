/* global inject Given When Then Before After */
/**
 * Daily-contribution storyboard — @daily-contribution, on its own shard.
 *
 * A project the installer already set up gets one everyday change and carries it
 * the real GitLab way: an issue, a branch + merge request created from it, a
 * conventional `feat:` commit pushed on the branch, the merge request's pipeline
 * going green, the merge into main, and main's OWN pipeline stamping the next
 * version — no manual release. ONE Gherkin sentence = ONE card = ONE pixel
 * baseline, asserted inside the step (tolerance: 0); each GitLab page is masked
 * for its volatile chrome and each terminal card is a real <pre> of the git
 * output, both twinned with a REST/git check of the same fact.
 *
 * The real MR and main pipelines run on a project-scoped runner registered inside
 * the shared gitlab-runner compose service; concurrent=1 serialises this story's
 * jobs with @install-complete's when the full suite runs locally, and the runner
 * is torn down surgically (its own token only) so neither scenario disturbs the
 * other. See support/helpers/pipelineRunner.js.
 */
const fs = require('fs')
const { I, GitLabProjectPage, GitLabRepositoryPage, GitLabMergeRequestPage } = inject()
const {
  BASE_URL,
  projectPath,
  getRootHeaders,
  createProject,
  deleteProject,
  createLambdaPersonalAccessToken,
  revokePersonalAccessToken,
  createProjectAccessToken,
  createProjectVariable,
  updateProjectSettings,
  listRepositoryTree,
  listPipelineJobs,
  createProjectIssue,
  createRepositoryBranch,
  createMergeRequest,
  getMergeRequest,
  mergeMergeRequest,
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
const { runTaskInRepo, runTaskInRepoCaptured } = require('../helpers/workspaceRepo')
const { renderProject } = require('../helpers/copierRender')
const { storyboardStep, addStoryboardFrame, capturePageFrame } = require('../../../../../.config/codeceptjs/storyboard')
const { renderPreFrame } = require('../helpers/capturedOutput')

const PROJECT_NAME = 'e2e-daily-contribution'
const ISSUE_TITLE = 'Mention the toolbox in the README'
// The branch GitLab's "Create merge request" button would open from issue #1.
const BRANCH = '1-mention-the-toolbox-in-the-readme'
const README_LINE = 'This project was scaffolded with The DevSecOps Toolbox.'
const COMMIT_SUBJECT = 'feat: mention the toolbox in the readme'

Before(() => {
  global.dailyProject = null
  global.dailyRepoDir = null
  global.dailyGlabToken = null
  global.dailyTokenId = null
  global.dailyIssueIid = null
  global.dailyMrIid = null
  global.dailyRunner = null
})

After(async () => {
  // Surgical: unregister ONLY this story's runner token (never --all-runners) so
  // @install-complete, which shares the compose service locally, is untouched.
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
  if (global.dailyRepoDir) {
    try { fs.rmSync(global.dailyRepoDir, { recursive: true, force: true }) } catch (_) {}
    global.dailyRepoDir = null
  }
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
// on the Given proves the push landed. hooksPath is voided so the story's later
// commit is fast and deterministic (protected-commits covers hook enforcement).
function pushFrameworkToMain (repoDir, token) {
  const user = process.env.TASK_GITLAB_LAMBDA_USER
  const remote = `http://${user}:${encodeURIComponent(token)}@gitlab/${user}/${PROJECT_NAME}.git`
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
// toolbox's own moving version) pushed to main with its automation tokens wired,
// and that same render is the developer's working repo for the git steps.
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
  global.dailyRepoDir = repoDir
  pushFrameworkToMain(repoDir, token)
  await wireAutomationVariable(PROJECT_NAME, 'TASK_COMMITIZEN_TOKEN', rootHeaders)
  await wireAutomationVariable(PROJECT_NAME, 'TASK_RENOVATE_TOKEN', rootHeaders)
  // Fast-forward merges so the change joins main as a straight line, the way the
  // toolbox configures a real project.
  await updateProjectSettings(PROJECT_NAME, { merge_method: 'ff', remove_source_branch_after_merge: true }, rootHeaders)

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

storyboardStep(Then, 'a merge request opens from the issue, with its own branch', async () => {
  const lambdaHeaders = { 'PRIVATE-TOKEN': global.dailyGlabToken }
  // Mirror the "Create merge request" button, as the developer: a branch off
  // main and an MR that closes the issue.
  const branch = await createRepositoryBranch(PROJECT_NAME, BRANCH, 'main', lambdaHeaders)
  if (branch.status >= 400) throw new Error(`Failed to create branch "${BRANCH}" (status ${branch.status}): ${JSON.stringify(branch.data)}`)
  const mr = await createMergeRequest(
    PROJECT_NAME,
    {
      source_branch: BRANCH,
      target_branch: 'main',
      title: `Resolve "${ISSUE_TITLE}"`,
      description: `Closes #${global.dailyIssueIid}`,
      remove_source_branch: true
    },
    lambdaHeaders
  )
  if (mr.status >= 400) throw new Error(`Failed to open the merge request (status ${mr.status}): ${JSON.stringify(mr.data)}`)
  global.dailyMrIid = mr.data.iid
  I.resizeWindow(1024, 640)
  await GitLabMergeRequestPage.gotoAndMask(projectPath(PROJECT_NAME), global.dailyMrIid, PROJECT_NAME)
  await addStoryboardFrame(I, await capturePageFrame(I, 'mr-from-issue'))
  I.resizeWindow(1024, 768)
  // Twin: the MR is open, on its own branch, targeting main.
  if (mr.data.state !== 'opened') throw new Error(`Expected the MR open, got state=${mr.data.state}`)
  if (mr.data.source_branch !== BRANCH || mr.data.target_branch !== 'main') {
    throw new Error(`Expected MR ${BRANCH} -> main, got ${mr.data.source_branch} -> ${mr.data.target_branch}`)
  }
})

// ============================================
// Chapter 2 — the change rides a merge request
// ============================================

storyboardStep(When, 'the developer checks out the branch and edits the README', async () => {
  const repoDir = global.dailyRepoDir
  const token = global.dailyGlabToken
  runTaskInRepo('git fetch origin', repoDir, token, { stdio: ['ignore', 'pipe', 'pipe'] })
  runTaskInRepo(`git checkout ${BRANCH}`, repoDir, token, { stdio: ['ignore', 'pipe', 'pipe'] })
  // Add the line to the README (create it if the generated project ships none).
  fs.appendFileSync(`${repoDir}/README.md`, `\n${README_LINE}\n`)
  const branchOut = runTaskInRepoCaptured('git branch --show-current', repoDir, token)
  const tailOut = runTaskInRepoCaptured('tail -1 README.md', repoDir, token)
  const branch = (branchOut.output || '').trim()
  const lastLine = (tailOut.output || '').trim()
  await renderPreFrame(I, 'branch-and-edit', `$ git branch --show-current\n${branch}\n\n$ tail -1 README.md\n${lastLine}`)
  // Twin: on the issue's branch, and the README now carries the developer's line.
  if (branch !== BRANCH) throw new Error(`Expected to be on ${BRANCH}, got "${branch}"`)
  if (lastLine !== README_LINE) throw new Error(`Expected the README to end with the added line, got "${lastLine}"`)
})

storyboardStep(When, 'the developer commits the change as a conventional feat', async () => {
  const repoDir = global.dailyRepoDir
  const token = global.dailyGlabToken
  runTaskInRepo(`git add README.md && git commit -m "${COMMIT_SUBJECT}"`, repoDir, token, { stdio: ['ignore', 'pipe', 'pipe'] })
  const logOut = runTaskInRepoCaptured("git log --format='%s' -1", repoDir, token)
  const subject = (logOut.output || '').trim()
  await renderPreFrame(I, 'conventional-commit', `$ git log --format='%s' -1\n${subject}`)
  // Twin: the top commit is the conventional feat the release will version.
  if (subject !== COMMIT_SUBJECT) throw new Error(`Expected the feat commit on top, got "${subject}"`)
})

storyboardStep(When, 'the developer pushes the branch to GitLab', async () => {
  const repoDir = global.dailyRepoDir
  const token = global.dailyGlabToken
  try {
    // Swallow push output: git echoes the token-embedded remote URL on stderr.
    // The twin below fails loud if the branch did not reach GitLab.
    runTaskInRepo(`git push origin ${BRANCH}`, repoDir, token, { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (_) {}
  const remoteLog = runTaskInRepoCaptured(`git log origin/${BRANCH} --format='%s' -1`, repoDir, token)
  const remoteSubject = (remoteLog.output || '').trim()
  await renderPreFrame(I, 'push-to-gitlab', `$ git push origin ${BRANCH}\n$ git log origin/${BRANCH} --format='%s' -1\n${remoteSubject}`)
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
  // actually watches (the stage-graph pipeline page cuts off at this width);
  // the REST twin above already read every job's real state.
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
  I.resizeWindow(1024, 900)
  await GitLabMergeRequestPage.gotoAndMaskMerged(projectPath(PROJECT_NAME), global.dailyMrIid, PROJECT_NAME)
  await addStoryboardFrame(I, await capturePageFrame(I, 'merged-into-main'))
  I.resizeWindow(1024, 768)
})

storyboardStep(Then, "main's pipeline stamps the next version tag", async () => {
  const rootHeaders = await getRootHeaders()
  // The merge fired main's own pipeline; its release job reads the feat and
  // pushes the new tag + bumped VERSION. Wait it green before reading the tag.
  const { pid, status } = await waitRefPipeline(I, PROJECT_NAME, 'main', rootHeaders)
  if (status !== 'success') {
    const jobs = pid ? ((await listPipelineJobs(PROJECT_NAME, pid, rootHeaders)).data || []) : []
    jobs.sort((a, b) => a.id - b.id)
    console.log(`main pipeline not green (status=${status}, pipeline ${pid})`)
    dumpFailedTraces(PROJECT_NAME, jobs, rootHeaders, global.dailyRunner && global.dailyRunner.svc)
    throw new Error(`Expected main's pipeline to pass, got status=${status}`)
  }
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

storyboardStep(Then, 'the new version now lives in the files on main', async () => {
  const repoDir = global.dailyRepoDir
  const token = global.dailyGlabToken
  runTaskInRepo('git fetch origin', repoDir, token, { stdio: ['ignore', 'pipe', 'pipe'] })
  const versionOut = runTaskInRepoCaptured('git show origin/main:VERSION', repoDir, token)
  const version = (versionOut.output || '').trim()
  const readmeOut = runTaskInRepoCaptured('git show origin/main:README.md', repoDir, token)
  const readme = readmeOut.output || ''
  // Twin FIRST: the release wrote 0.2.0 into VERSION and the README carries the line.
  if (version !== '0.2.0') throw new Error(`Expected VERSION 0.2.0 on main, got "${version}"`)
  if (!readme.includes(README_LINE)) throw new Error('Expected README on main to carry the developer line')
  // The project home on main: the file list plus the rendered README, now with
  // the developer's line — the visual bookend to the "installed project" card.
  I.resizeWindow(1024, 640)
  await I.amOnPage(`/${projectPath(PROJECT_NAME)}`)
  await GitLabRepositoryPage.maskVolatile(PROJECT_NAME)
  await addStoryboardFrame(I, await capturePageFrame(I, 'files-on-main'))
  I.resizeWindow(1024, 768)
})
