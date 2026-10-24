/* global inject Given When Then After */
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync, spawnSync } = require('child_process')
const { I, GitLabUserPage } = inject()
const { REPO, toolboxRepository } = require('../helpers/frameworkCopy')
const { publishToGitLab } = require('../helpers/gitlabProject')
const {
  BASE_URL, createMergeRequestWhenBranchExists, listPipelineJobs, getRootHeaders,
  createProjectRunner, deleteRunner, getJobTrace, getJobArtifact, createProjectVariable, updateProjectVariable, readProjectVariable, cancelPipeline
} = require('../helpers/gitlabApi')
const { freshGet, freshPut, freshDelete } = require('../helpers/http')
const { gitlabFrame, gitlabUrl, jobLogFrame, unfoldFileTree } = require('../helpers/gitlabCard')
const { startIsolatedRunnerService, RUNNER_NET } = require('../helpers/pipelineRunner')
const { openLocalTerminal } = require('../helpers/localTerminal')
const { terminalCard } = require('../terminal/capture')
const { composeService } = require('../helpers/docker')
const { resetFileTreeScroll } = require('../helpers/deployOnlyFixture')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const DIR = '/tmp/e2e-deploy-only-pipeline'
const PATHS = 'TASK_DEVSECOPS_TEST_DEPLOY_PATHS'
const REGEXP = 'TASK_DEVSECOPS_DEPLOY_ONLY_REGEXP'
const LIST = 'deploy/\ncharts/values-prod.yaml\n'
const PATTERN = '\\A(?!(?:deploy/|charts/values-prod\\.yaml\\z))'
const OVERLAY = 'deploy/overlays/prod/kustomization.yaml'
const BROKEN_PYTHON = 'project/src/broken.py'
const LINT_POLL_SECONDS = 2
const CHECKS = ['code:all', 'code:betterleaks', 'code:commitizen-bump-dry', 'code:commitizen-check',
  'code:commitlint', 'code:megalinter', 'code:project', 'code:renovate-validate', 'release']
const FULL = [...CHECKS, 'plan', 'build', 'test', 'deploy', 'operate', 'monitor', 'feedback', 'code:lizard', 'no-cheat']
let state

function git (...args) {
  return execFileSync('git', args, { cwd: DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function write (file, contents) {
  const target = path.join(DIR, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, contents)
}

function configure (list = LIST) {
  // Known inputs test GitLab's selection independently of the generator. The
  // last chapter runs the generator itself and checks it produces these values.
  const original = fs.readFileSync(path.join(REPO, '.gitlab-ci.yml'), 'utf8')
  const variables = { [REGEXP]: '' }
  write('.gitlab-ci.yml', original.replace(/^variables:\n[\s\S]*?(?=^include:)/m,
    'variables:\n' + Object.entries(variables).map(([key, value]) => `  ${key}: ${JSON.stringify(value)}\n`).join('') + '\n') +
    '\ncode:megalinter:\n  tags: [deployment-lint]\n  before_script:\n    - .config/task/install.sh\n    - task project:test:deployment-only:scanner-modes\n')
  write('.env.dist', `${PATHS}='${list}'\n`)
  write('.env.dev', '')
}

async function branchPipeline (branch, changes, expected) {
  git('checkout', '-q', '-B', branch, 'main')
  changes()
  git('add', '-A')
  git('commit', '-qm', 'chore: promote the application')
  state.pub.push(branch)
  const mr = await createMergeRequestWhenBranchExists(state.pub.projectName,
    { source_branch: branch, target_branch: 'main', title: 'Promote the application' }, state.pub.headers)
  assert.ok(mr.status < 400, JSON.stringify(mr.data))
  const endpoint = `${BASE_URL}/api/v4/projects/${state.pub.projectId}/merge_requests/${mr.data.iid}/pipelines`
  const sha = git('rev-parse', 'HEAD')
  const deadline = Date.now() + 120000
  let pipeline
  while (!pipeline && Date.now() < deadline) {
    const pipelines = await freshGet(endpoint, state.pub.headers)
    assert.equal(pipelines.status, 200)
    pipeline = pipelines.data.find(item => item.sha === sha)
    if (!pipeline) await new Promise(resolve => setTimeout(resolve, 1000))
  }
  assert.ok(pipeline, 'Opening the merge request must create its pipeline')
  await waitForPipeline(pipeline.id)
  const jobs = await listPipelineJobs(state.pub.projectName, pipeline.id, state.pub.headers)
  assert.equal(jobs.status, 200)
  assert.deepEqual(jobs.data.map(job => job.name).sort(), [...expected].sort(),
    `GitLab must create exactly the jobs needed for the entire merge request (${branch})`)
  console.log(`Deployment fixture ${branch}: ${jobs.data.length} jobs`)
  return pipeline.id
}

async function waitForPipeline (pipeline) {
  const deadline = Date.now() + 30000
  let status
  let problem
  do {
    const response = await freshGet(`${BASE_URL}/api/v4/projects/${state.pub.projectId}/pipelines/${pipeline}`, state.pub.headers)
    status = response.data.status
    problem = response.data.yaml_errors || response.data.failure_reason
    if (status !== 'created') break
    await new Promise(resolve => setTimeout(resolve, 500))
  } while (Date.now() < deadline)
  assert.ok(['pending', 'running'].includes(status), `Pipeline creation must have settled, got ${status}: ${problem || 'no configuration error'}`)
}

async function pipelineCard (name, pipeline) {
  await waitForPipeline(pipeline)
  await gitlabFrame(I, name, gitlabUrl.pipeline(state.pub.projectName, pipeline), {
    projectNames: [state.pub.projectName], waitText: 'code:project', height: 1100
  })
}

async function cancelFixturePipelines (fixture, keepPipeline, headers) {
  // Selection cases create more than GitLab's default 20-item page. Drain all
  // fixture pages before starting a single-slot runner for an execution proof.
  for (let page = 1; ; page++) {
    const response = await freshGet(`${BASE_URL}/api/v4/projects/${fixture.projectId}/pipelines?per_page=100&page=${page}`, headers)
    assert.equal(response.status, 200)
    for (const pipeline of response.data) {
      if (pipeline.id !== keepPipeline && !['success', 'failed', 'canceled', 'skipped'].includes(pipeline.status)) {
        await cancelPipeline(fixture.projectName, pipeline.id, headers)
      }
    }
    if (response.data.length < 100) break
  }
}

After(async (test) => {
  if (!test?.tags?.includes('@deploy-only-pipeline')) return
  const finished = state
  state = null
  if (finished?.closeTerminal) finished.closeTerminal()
  if (finished?.pub) {
    const root = await getRootHeaders()
    await cancelFixturePipelines(finished.pub, 0, root)
    if (finished.runner) await deleteRunner(finished.runner, root)
    if (finished.executionRunner) await deleteRunner(finished.executionRunner, root)
    if (finished.owner) {
      const owned = docker('ps', '--all', '--quiet', '--filter', `label=io.digital-commons.e2e.run=${finished.owner}`).trim()
      if (owned) docker('rm', '--force', '--volumes', ...owned.split('\n'))
    }
    await finished.pub.teardown()
  }
  fs.rmSync(DIR, { recursive: true, force: true })
})

storyboardStep(Given, 'a project whose pipeline names a deployment folder and a single deployment file', async () => {
  fs.mkdirSync(DIR, { recursive: true })
  toolboxRepository(DIR)
  // Exercise the pipeline shipped to projects, including its single test job.
  for (const name of ['test', 'code']) {
    fs.copyFileSync(path.join(REPO, `.config/gitlab/ci/devsecops/${name}.yml.jinja`),
      path.join(DIR, `.config/gitlab/ci/devsecops/${name}.yml`))
  }
  configure()
  write(OVERLAY, 'images:\n  - name: app\n    newTag: "1.0"\n')
  write('charts/values-prod.yaml', 'image: app:1.0\n')
  write('project/src/app.js', "module.exports = 'hello'\n")
  write(BROKEN_PYTHON, 'def broken(:\n')
  write('project/tests/app.test.js', "require('../src/app')\n")
  git('add', '-A')
  git('commit', '-qm', 'chore: configure the deployment paths')
  state = { pub: await publishToGitLab(DIR, { name: `deployment-only-${crypto.randomBytes(4).toString('hex')}`, project: { shared_runners_enabled: false } }) }
  const stored = await createProjectVariable(state.pub.projectName, {
    key: REGEXP, value: PATTERN, raw: true, protected: false, masked: false, environment_scope: '*'
  }, state.pub.headers)
  assert.equal(stored.status, 201)
  await GitLabUserPage.loginAs(process.env.TASK_GITLAB_LAMBDA_USER, process.env.TASK_GITLAB_LAMBDA_PASSWORD)
  await gitlabFrame(I, 'deployment-paths', gitlabUrl.file(state.pub.projectName, 'main', '.env.dist'), {
    projectNames: [state.pub.projectName],
    waitText: PATHS,
    // GitLab loads the file tree separately from the blob. Open the configured
    // paths explicitly and wait for their children before capturing the page.
    prepare: () => unfoldFileTree(I, ['deploy', 'overlays', 'prod', 'charts']),
    scrollTo: () => resetFileTreeScroll(I),
    height: 1100,
    textMasks: [[/\b\d+\.\d+\.\d+\b/g, '<version>']]
  })
})

storyboardStep(Then, 'GitLab creates only code checks and release for the deployment-only merge request', async () => {
  const pipeline = await branchPipeline('promote', () => write(OVERLAY, 'images:\n  - name: app\n    newTag: "2.0"\n'), CHECKS)
  state.originalPipeline = pipeline
  await pipelineCard('deployment-only-jobs', pipeline)
})

storyboardStep(Then, 'adding application code to the merge request restores the whole pipeline', async () => {
  const pipeline = await branchPipeline('mixed-change', () => {
    write(OVERLAY, 'images:\n  - name: app\n    newTag: "2.0"\n')
    write('project/src/app.js', "module.exports = 'hello, world'\n")
  }, FULL)
  // A single-file allowlist must not cover a sibling or a renamed code file.
  const neighbour = await branchPipeline('neighbour', () => {
    write('charts/values-prod.yaml.bak', 'image: app:2.0\n')
    const ci = fs.readFileSync(path.join(DIR, '.gitlab-ci.yml'), 'utf8')
    write('.gitlab-ci.yml', ci.replace('variables:\n', 'variables:\n  MEGALINTER_ALLOW_FAILURE: "true"\n'))
  }, FULL)
  const jobs = await listPipelineJobs(state.pub.projectName, neighbour, state.pub.headers)
  assert.equal(jobs.data.find(job => job.name === 'code:megalinter').allow_failure, true,
    'Mixed changes must keep the existing MegaLinter failure policy')
  await branchPipeline('rename-code', () => git('mv', 'project/src/app.js', 'deploy/app.js'), FULL)
  await branchPipeline('rename-test', () => git('mv', 'project/tests/app.test.js', 'deploy/check.js'), FULL)
  await branchPipeline('single-file', () => write('charts/values-prod.yaml', 'image: app:2.0\n'), CHECKS)
  for (const [branch, file, expected] of [
    ['nested-config', 'deploy/a/.config/tool.yml', FULL],
    ['nested-tests', 'deploy/a/tests/check.js', FULL],
    ['test-file', 'deploy/a/manifest.test.js', FULL],
    ['test-prefix', 'deploy/a/test_policy.py', FULL],
    ['agent-controls', 'deploy/a/.agents/control.md', FULL],
    ['nested-taskfile', 'deploy/a/Taskfile.yml', FULL],
    ['nested-agent-file', 'deploy/a/AGENTS.md', FULL],
    ['configuration-name', 'deploy/.configuration/settings.yaml', CHECKS],
    ['newline-outside', 'project/src/name\ndeploy/image.yaml', FULL],
    ['newline-inside', 'deploy/name\nimage.yaml', CHECKS]
  ]) await branchPipeline(branch, () => write(file, 'fixture\n'), expected)
  const endpoint = `${BASE_URL}/api/v4/projects/${state.pub.projectId}/variables/${REGEXP}`
  assert.equal((await freshDelete(endpoint, state.pub.headers)).status, 204)
  await branchPipeline('missing-policy', () => write(OVERLAY, 'images: []\n'), FULL)
  assert.equal((await createProjectVariable(state.pub.projectName, { key: REGEXP, value: '', raw: true }, state.pub.headers)).status, 201)
  await branchPipeline('empty-policy', () => write(OVERLAY, 'images: []\n'), FULL)
  assert.equal((await updateProjectVariable(state.pub.projectName, REGEXP, { value: '\\A' }, state.pub.headers)).status, 200)
  await branchPipeline('full-fallback', () => write(OVERLAY, 'images: []\n'), FULL)
  assert.equal((await updateProjectVariable(state.pub.projectName, REGEXP, { value: PATTERN }, state.pub.headers)).status, 200)
  await pipelineCard('mixed-change-jobs', pipeline)
})

function planFromMain (token) {
  const env = {
    ...process.env,
    CI: 'true',
    CI_COMMIT_BRANCH: 'main',
    CI_DEFAULT_BRANCH: 'main',
    CI_COMMIT_SHA: git('rev-parse', 'main'),
    CI_API_V4_URL: `${BASE_URL}/api/v4`,
    CI_PROJECT_ID: String(state.pub.projectId),
    TASK_COMMITIZEN_TOKEN: token
  }
  for (const key of [PATHS, 'CI_COMMIT_TAG', 'CI_MERGE_REQUEST_IID']) delete env[key]
  return spawnSync('task', ['plan'], { cwd: DIR, env, encoding: 'utf8' })
}

storyboardStep(Then, 'a failed synchronization keeps the previous policy until a later plan repairs it', async () => {
  git('checkout', '-q', 'main')
  configure('charts/')
  git('commit', '-qam', 'chore: change the deployment list')
  state.pub.push('main')
  const failed = planFromMain('')
  assert.notEqual(failed.status, 0, 'A missing token must leave plan visibly failed')
  assert.equal((await readProjectVariable(state.pub.projectName, REGEXP, state.pub.headers)).data.value, PATTERN)
  await branchPipeline('stale-pattern', () => write(OVERLAY, 'images:\n  - name: app\n    newTag: "2.0"\n'), CHECKS)
  git('checkout', '-q', 'main')
  const repaired = planFromMain(state.pub.token)
  assert.equal(repaired.status, 0, repaired.stdout + repaired.stderr)
  const pipeline = await branchPipeline('repaired-pattern', () => write(OVERLAY, 'images:\n  - name: app\n    newTag: "3.0"\n'), FULL)
  const original = await listPipelineJobs(state.pub.projectName, state.originalPipeline, state.pub.headers)
  assert.deepEqual(original.data.map(job => job.name).sort(), [...CHECKS].sort(), 'An existing pipeline graph must remain unchanged after synchronization')
  await pipelineCard('stale-pattern-jobs', pipeline)
})

storyboardStep(Then, 'build test and deploy actually execute when the stored policy keeps the full pipeline', async () => {
  git('checkout', '-q', 'main')
  const originalTaskfile = fs.readFileSync(path.join(DIR, 'Taskfile.yml'), 'utf8')
  write('Taskfile.yml', 'version: "3"\ndotenv: [.env.dev, .env.dist]\ntasks:\n' + ['build', 'test', 'deploy'].map(name => `  ${name}:\n    cmds: ["echo EXECUTED-${name}"]\n`).join(''))
  const image = docker('inspect', '--format', '{{.Config.Image}}', composeService('codeceptjs')).trim()
  const ci = fs.readFileSync(path.join(DIR, '.gitlab-ci.yml'), 'utf8')
  write('.gitlab-ci.yml', ci + `\n.docker-job:\n  image:\n    name: ${image}\n    pull_policy: never\n  before_script: []\n  services: []\n` +
    ['build', 'test', 'deploy'].map(name => `${name}:\n  tags: [deployment-execution]\n`).join(''))
  git('add', '-A')
  git('commit', '-qm', 'test: observe execution of jobs selected by the stored fallback')
  state.pub.push('main')
  assert.equal((await updateProjectVariable(state.pub.projectName, REGEXP, { value: '\\A' }, state.pub.headers)).status, 200)
  const pipeline = await branchPipeline('execute-full-fallback', () => write(OVERLAY, 'images: []\n'), FULL)
  const root = await getRootHeaders()
  await cancelFixturePipelines(state.pub, pipeline, root)
  const runner = await createProjectRunner(state.pub.projectId, root, ['deployment-execution'])
  assert.equal(runner.status, 201)
  state.executionRunner = runner.data.id
  assert.equal((await freshPut(`${BASE_URL}/api/v4/runners/${runner.data.id}`, { run_untagged: false }, root)).status, 200)
  state.owner = crypto.randomBytes(8).toString('hex')
  const service = startIsolatedRunnerService(`e2e-execution-${state.owner}`, state.owner)
  docker('exec', service, 'gitlab-runner', 'register', '--non-interactive', '--url', BASE_URL,
    '--token', runner.data.token, '--executor', 'docker', '--docker-image', image,
    '--docker-pull-policy', 'never', '--docker-network-mode', RUNNER_NET, '--docker-privileged=false')
  docker('kill', '-s', 'HUP', service)
  const deadline = Date.now() + 240000
  let jobs
  do {
    jobs = (await listPipelineJobs(state.pub.projectName, pipeline, state.pub.headers)).data
    if (['build', 'test', 'deploy'].every(name => ['success', 'failed'].includes(jobs.find(job => job.name === name)?.status))) break
    await new Promise(resolve => setTimeout(resolve, 1000))
  } while (Date.now() < deadline)
  for (const name of ['build', 'test', 'deploy']) {
    const job = jobs.find(item => item.name === name)
    assert.equal(job?.status, 'success', `${name} must execute its task successfully`)
    const trace = await getJobTrace(state.pub.projectName, job.id, state.pub.headers)
    assert.ok(trace.includes(`EXECUTED-${name}`), `The created ${name} job must not exit before its task`)
  }
  const build = jobs.find(job => job.name === 'build')
  await jobLogFrame(I, 'full-fallback-executes', state.pub.projectName, build.id, { waitText: 'EXECUTED-build', projectNames: [state.pub.projectName] })
  git('checkout', '-q', 'main')
  write('Taskfile.yml', originalTaskfile)
  assert.equal((await updateProjectVariable(state.pub.projectName, REGEXP, { value: PATTERN }, state.pub.headers)).status, 200)
})

function task (...args) {
  return execFileSync('task', args, { cwd: DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

storyboardStep(Then, 'the effective deployment setting can be previewed without editing the pipeline', async () => {
  configure(LIST)
  assert.equal(task('--silent', 'devsecops:plan:deploy-only:pattern').trim(), PATTERN)
  const generated = fs.readFileSync(path.join(DIR, '.gitlab-ci.yml'), 'utf8')
  assert.equal(task('--silent', 'devsecops:plan:deploy-only:pattern').trim(), PATTERN)
  assert.equal(fs.readFileSync(path.join(DIR, '.gitlab-ci.yml'), 'utf8'), generated, 'Preview must not edit YAML')
  for (const list of ['', ' ', 'deploy/ charts/values-prod.yaml', 'missing-file.yaml', '../', '.', 'deploy/*', 'folder/'.repeat(50)]) {
    configure(list)
    const result = task('--silent', 'devsecops:plan:deploy-only:pattern').trim()
    assert.ok(result.length <= 255)
    if (['', ' ', '../', '.', 'deploy/*', 'folder/'.repeat(50)].includes(list)) {
      assert.equal(result, '\\A', 'Doubt must match every changed file')
    }
    assert.equal(fs.readFileSync(path.join(DIR, '.gitlab-ci.yml'), 'utf8'), generated)
  }
  configure(LIST)
  const env = { ...process.env }
  for (const key of ['TASK_E2E_UPDATE_BASELINES', 'TASK_CODECEPTJS_GREP', 'TASK_CODECEPTJS_FEATURES']) delete env[key]
  state.closeTerminal = await openLocalTerminal(I, { cwd: DIR, env, port: 7716, height: 800 })
  const screen = await terminalCard(I, 'generate-and-check',
    'task --silent devsecops:plan:deploy-only:pattern; echo "exit code $?"')
  assert.ok(screen.includes('exit code 0'))
  assert.equal(fs.readFileSync(path.join(DIR, '.gitlab-ci.yml'), 'utf8'), generated)
})

function docker (...args) {
  // Registration arguments carry a token; never include them in an error.
  try {
    return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 })
  } catch (_) {
    throw new Error(`The deployment-only fixture's Docker ${args[0]} operation failed`)
  }
}

storyboardStep(When, 'a merge request contains a malformed deployment file', async () => {
  state.closeTerminal()
  state.closeTerminal = null
  git('checkout', '-q', '-B', 'main')
  git('add', '-A')
  git('commit', '-qm', 'chore: regenerate deployment paths')
  state.pub.push('main')
  assert.equal((await updateProjectVariable(state.pub.projectName, REGEXP, { value: PATTERN }, state.pub.headers)).status, 200)
  state.lintPipeline = await branchPipeline('invalid-deployment', () => write(OVERLAY, 'images: [\n'), CHECKS)
  await waitForPipeline(state.lintPipeline)
  await gitlabFrame(I, 'invalid-deployment-yaml', gitlabUrl.file(state.pub.projectName, 'invalid-deployment', OVERLAY), {
    projectNames: [state.pub.projectName], waitText: 'images: ['
  })
})

storyboardStep(Then, 'MegaLinter checks only the changed deployment file', async () => {
  const pipeline = state.lintPipeline
  await cancelFixturePipelines(state.pub, pipeline, await getRootHeaders())
  const root = await getRootHeaders()
  const runner = await createProjectRunner(state.pub.projectId, root, ['deployment-lint'])
  assert.ok(runner.status < 400, 'The fixture needs a runner for its MegaLinter job')
  state.runner = runner.data.id
  const configured = await freshPut(`${BASE_URL}/api/v4/runners/${state.runner}`, { run_untagged: false }, root)
  assert.equal(configured.status, 200)
  state.owner = state.owner || crypto.randomBytes(8).toString('hex')
  const service = startIsolatedRunnerService(`e2e-deployment-${state.owner}`, state.owner)
  docker('exec', service, 'gitlab-runner', 'register', '--non-interactive', '--url', 'http://gitlab', // DevSkim: ignore DS137138 -- Isolated test GitLab.
    '--token', runner.data.token, '--executor', 'docker', '--docker-image', 'alpine:3.20',
    '--docker-network-mode', RUNNER_NET, '--docker-privileged=false')
  docker('kill', '-s', 'HUP', service)
  const deadline = Date.now() + 600000
  let job
  let lastStatus
  do {
    const jobs = await listPipelineJobs(state.pub.projectName, pipeline, state.pub.headers)
    job = jobs.data.find(item => item.name === 'code:megalinter')
    if (job?.status !== lastStatus) console.log(`Deployment YAML scan: ${job?.status}`)
    lastStatus = job?.status
    if (['success', 'failed', 'canceled'].includes(job?.status)) break
    await I.wait(LINT_POLL_SECONDS)
  } while (Date.now() < deadline)
  assert.equal(job?.status, 'failed', 'Invalid deployment YAML must fail MegaLinter')
  const trace = await getJobTrace(state.pub.projectName, job.id, state.pub.headers)
  state.lintJob = job
  state.lintTrace = trace
  fs.writeFileSync(path.join(__dirname, '../../_output/deploy-only-megalinter.log'), trace)
  assert.ok(trace.includes('Kept [1] files on [1] found files'), 'Only the changed file must be selected')
  assert.ok(!trace.includes(BROKEN_PYTHON), 'The unchanged Python syntax error must not be scanned in reduced mode')
  await jobLogFrame(I, 'megalinter-changed-files', state.pub.projectName, job.id, {
    waitText: 'Job failed',
    from: 'Listing updated files in',
    focus: 'Kept [1] files on [1] found files',
    height: 1100,
    fold: ['Preparing', 'Getting source', 'Restoring cache', 'Uploading artifacts', 'Cleaning up', 'files with ['],
    unfold: ['MegaLinter now collects'],
    masks: [[/\(\d+(?:\.\d+)?s\)/g, '(<duration>)']]
  })
})

storyboardStep(Then, 'MegaLinter rejects the malformed deployment YAML', async () => {
  assert.ok(state.lintTrace.includes(OVERLAY) && state.lintTrace.includes('syntax error'), 'The YAML error must name the changed file')
  await jobLogFrame(I, 'megalinter-yaml-error', state.pub.projectName, state.lintJob.id, {
    waitText: 'Job failed',
    from: 'syntax error',
    lead: 4,
    focus: 'syntax error',
    height: 900,
    fold: ['Preparing', 'Getting source', 'Restoring cache', 'Uploading artifacts', 'Cleaning up'],
    unfold: ['YAML'],
    masks: [[/\(\d+(?:\.\d+)?s\)/g, '(<duration>)']]
  })
})

async function lintBranch (branch, changes, expected) {
  const pipeline = await branchPipeline(branch, changes, expected)
  await cancelFixturePipelines(state.pub, pipeline, await getRootHeaders())
  const deadline = Date.now() + 600000
  let job
  let lastStatus
  do {
    const jobs = await listPipelineJobs(state.pub.projectName, pipeline, state.pub.headers)
    job = jobs.data.find(item => item.name === 'code:megalinter')
    if (job?.status !== lastStatus) console.log(`Deployment ${branch} scan: ${job?.status}`)
    lastStatus = job?.status
    if (['success', 'failed', 'canceled'].includes(job?.status)) break
    await I.wait(LINT_POLL_SECONDS)
  } while (Date.now() < deadline)
  assert.ok(['success', 'failed'].includes(job?.status), `The scan must finish, got ${job?.status}`)
  const trace = await getJobTrace(state.pub.projectName, job.id, state.pub.headers)
  fs.writeFileSync(path.join(__dirname, `../../_output/deploy-only-${branch}.log`), trace)
  return { job, trace }
}

async function findings (job) {
  const report = JSON.parse(await getJobArtifact(state.pub.projectName, job.id, 'megalinter-reports/megalinter-report.sarif', state.pub.headers))
  fs.writeFileSync(path.join(__dirname, `../../_output/deploy-only-job-${job.id}.sarif`), JSON.stringify(report))
  return (report.runs || []).flatMap(run => run.results || [])
}

function forFile (finding, file) {
  return (finding.locations || []).some(location => location.physicalLocation?.artifactLocation?.uri?.endsWith(file))
}

storyboardStep(Then, 'fixing only the deployment YAML passes without scanning unchanged Python', async () => {
  const fixed = await lintBranch('valid-deployment', () => write(OVERLAY, 'images:\n  - name: app\n    newTag: "4.0"\n'), CHECKS)
  assert.equal(fixed.job.status, 'success', fixed.trace.slice(-6000))
  assert.ok(!fixed.trace.includes(BROKEN_PYTHON))
  await jobLogFrame(I, 'valid-deployment-yaml', state.pub.projectName, fixed.job.id, {
    waitText: 'Job succeeded',
    from: 'Linted [YAML] files with [yamllint]',
    focus: 'Linted [YAML] files with [yamllint]',
    height: 950,
    unfold: ['YAML'],
    masks: [[/\(\d+(?:\.\d+)?s\)/g, '(<duration>)']]
  })
})

storyboardStep(Then, 'a mixed Python change restores its syntax check', async () => {
  const mixed = await lintBranch('mixed-python', () => {
    write(OVERLAY, 'images:\n  - name: app\n    newTag: "5.0"\n')
    write(BROKEN_PYTHON, 'def changed(:\n')
  }, FULL)
  assert.equal(mixed.job.status, 'failed')
  assert.ok((await findings(mixed.job)).some(finding => forFile(finding, BROKEN_PYTHON) && /syntax|parse|expected|invalid/i.test(finding.message?.text || '')), 'The full scan must report the changed Python syntax error')
  await jobLogFrame(I, 'mixed-python-error', state.pub.projectName, mixed.job.id, {
    waitText: 'Job failed',
    from: BROKEN_PYTHON,
    focus: BROKEN_PYTHON,
    height: 950,
    unfold: ['PYTHON'],
    masks: [[/\(\d+(?:\.\d+)?s\)/g, '(<duration>)']]
  })
})

function pod (privileged) {
  return `---
apiVersion: v1
kind: Pod
metadata:
  name: deployment-policy
  namespace: production
  labels:
    app: deployment-policy
spec:
  automountServiceAccountToken: false
  hostNetwork: false
  hostPID: false
  hostIPC: false
  securityContext:
    runAsNonRoot: true
    runAsUser: 10001
    runAsGroup: 10001
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: application
      image: gcr.io/deployment-fixture/application:1.0.0@sha256:${'a'.repeat(64)}
      imagePullPolicy: Always
      securityContext:
        privileged: ${privileged}
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: [ALL]
      resources:
        requests:
          cpu: 100m
          memory: 128Mi
        limits:
          cpu: 200m
          memory: 256Mi
      livenessProbe:
        httpGet:
          path: /health
          port: 8080
      readinessProbe:
        httpGet:
          path: /health
          port: 8080
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deployment-policy
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: deployment-policy
  policyTypes: [Ingress, Egress]
  ingress: []
  egress: []
`
}

storyboardStep(Then, 'the reduced security scan rejects a privileged container', async () => {
  const bad = await lintBranch('privileged-deployment', () => write('deploy/pod.yaml', pod(true)), CHECKS)
  assert.equal(bad.job.status, 'failed')
  const privileged = finding => finding.ruleId === 'CKV_K8S_16' && forFile(finding, 'deploy/pod.yaml')
  assert.ok((await findings(bad.job)).some(privileged), 'Checkov must reject the changed privileged container')
  await jobLogFrame(I, 'privileged-container-error', state.pub.projectName, bad.job.id, {
    waitText: 'Job failed',
    from: 'Container should not be privileged',
    focus: 'Container should not be privileged',
    height: 950,
    unfold: ['checkov'],
    masks: [[/\(\d+(?:\.\d+)?s\)/g, '(<duration>)']]
  })
})

storyboardStep(Then, 'correcting the privileged container passes the reduced security scan', async () => {
  const fixed = await lintBranch('safe-deployment', () => write('deploy/pod.yaml', pod(false)), CHECKS)
  const privileged = finding => finding.ruleId === 'CKV_K8S_16' && forFile(finding, 'deploy/pod.yaml')
  assert.ok(!(await findings(fixed.job)).some(privileged), 'Correcting privileged must remove the finding')
  assert.equal(fixed.job.status, 'success', fixed.trace.slice(-6000))
  await jobLogFrame(I, 'safe-container', state.pub.projectName, fixed.job.id, {
    waitText: 'Job succeeded',
    from: 'Linted [REPOSITORY] files with [checkov]',
    focus: 'Linted [REPOSITORY] files with [checkov]',
    height: 950,
    unfold: ['checkov'],
    masks: [[/\(\d+(?:\.\d+)?s\)/g, '(<duration>)']]
  })
})
