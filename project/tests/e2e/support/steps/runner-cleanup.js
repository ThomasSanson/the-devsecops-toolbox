/* global inject Given When Then Before After */
const { I, GitLabUserPage } = inject()
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const { composeService } = require('../helpers/docker')
const {
  BASE_URL, getRootHeaders, createLambdaPersonalAccessToken, revokePersonalAccessToken,
  createProject, deleteProject, getJobTrace, getJobArtifact, getRunnerCard
} = require('../helpers/gitlabApi')
const { freshGet, freshPost } = require('../helpers/http')
const { jobLogFrame } = require('../helpers/gitlabCard')
const { runnersFrame } = require('../helpers/runnersCard')
const { registerScopedRunner, teardownScopedRunner, cancelRedundantPipelines, RUNNER_NET } = require('../helpers/pipelineRunner')

const FIXTURES = path.join(__dirname, '../../fixtures/runner-cleanup')
// The two projects show as "first-project" and "second-project". Their random
// suffix starts with x, not a hex digit, so the job log's SHA mask leaves it
// whole for this mask to remove.
const SUFFIX_MASK = [/-x[0-9a-f]{12}\b/g, '']
const WAIT_LINE = '$ while [ ! -f /tmp/job-release ]; do sleep 1; done'
// The runner's own setup sections are folded, the way a reader skips them.
const SETUP_SECTIONS = ['Preparing the "docker" executor', 'Preparing environment', 'Getting source from Git repository']
// The same height for both job cards: before and after read as a pair.
const JOB_CARD_HEIGHT = 720
let state

Before(() => { state = { projects: [], runners: [], environment: {} } })
// CodeceptJS fires a Gherkin After without awaiting it: the next scenario's
// Before replaces `state` while this one still awaits GitLab, so it keeps its own.
After(async () => {
  const s = state
  if (!s.directory) return
  // First, before any await: the next scenario must not find docker through
  // this one's discovery adapter.
  for (const [key, value] of Object.entries(s.environment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  let finished = !s.job
  try {
    for (const project of s.projects) await cancelRedundantPipelines(project.name, 0, s.root)
    if (s.job) {
      await poll(async () => {
        const response = await freshGet(`${BASE_URL}/api/v4/projects/${s.first.id}/jobs/${s.job.id}`, s.headers)
        return ['success', 'failed', 'canceled'].includes(response.data?.status)
      }, 'the fixture job to finish cancellation')
      finished = true
    }
    for (const runner of s.runners) await teardownScopedRunner(runner, s.root)
    for (const project of s.projects) await deleteProject(project.name, s.headers)
    if (s.tokenId) await revokePersonalAccessToken(s.tokenId, s.root)
  } finally {
    try {
      // Preserve a live job if GitLab cannot confirm its cancellation. Only
      // finished fixture jobs and our disposable service can be removed.
      if (finished && s.docker && s.owner) {
        const docker = (...args) => execFileSync(s.docker, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 })
        const owned = docker('ps', '--all', '--quiet', '--filter', `label=io.digital-commons.e2e.run=${s.owner}`).trim()
        if (owned) docker('rm', '--force', '--volumes', ...owned.split('\n'))
      }
    } finally {
      fs.rmSync(s.directory, { recursive: true, force: true })
    }
  }
})

function docker (...args) {
  // Observations always use the real client. Only the helper under test sees
  // the bounded discovery adapter; no Docker or GitLab result is mocked.
  return execFileSync(state.docker, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 })
}

function configureEnvironment (key, value) {
  state.environment[key] = process.env[key]
  process.env[key] = value
}

async function isolateRunner () {
  state.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-cleanup-'))
  state.owner = crypto.randomBytes(8).toString('hex')
  state.docker = execFileSync('which', ['docker'], { encoding: 'utf8' }).trim()
  const image = docker('inspect', '--format', '{{.Config.Image}}', composeService('gitlab-runner')).trim()
  state.service = `e2e-cleanup-${state.owner}-gitlab-runner-1`
  const config = path.join(state.directory, 'config.toml')
  const template = path.join(state.directory, 'template.toml')
  fs.writeFileSync(config, 'concurrent = 1\ncheck_interval = 0\n')
  fs.writeFileSync(template,
    '[[runners]]\n  [runners.docker]\n    [runners.docker.container_labels]\n' +
    `      "io.digital-commons.e2e.run" = "${state.owner}"\n`)
  docker('create', '--name', state.service, '--network', RUNNER_NET,
    '--label', `io.digital-commons.e2e.run=${state.owner}`,
    '--env', 'TEMPLATE_CONFIG_FILE=/etc/gitlab-runner/template.toml',
    '--volume', '/var/run/docker.sock:/var/run/docker.sock', image)
  docker('cp', config, `${state.service}:/etc/gitlab-runner/config.toml`)
  docker('cp', template, `${state.service}:/etc/gitlab-runner/template.toml`)
  docker('start', state.service)
  const adapter = path.join(state.directory, 'docker')
  fs.copyFileSync(path.join(FIXTURES, 'limit-docker-discovery.sh'), adapter)
  fs.chmodSync(adapter, 0o700)
  configureEnvironment('TASK_E2E_REAL_DOCKER', state.docker)
  configureEnvironment('TASK_E2E_RUN_OWNER', state.owner)
  configureEnvironment('PATH', `${state.directory}:${process.env.PATH}`)
}

async function createFixtureProject (label) {
  const name = `${label}-x${crypto.randomBytes(6).toString('hex')}`
  const response = await createProject({
    name,
    visibility: 'public',
    initialize_with_readme: false,
    shared_runners_enabled: false,
    group_runners_enabled: false
  }, state.headers)
  assert.equal(response.status, 201, 'GitLab must create the isolated fixture project')
  const project = { name, id: response.data.id }
  state.projects.push(project)
  return project
}

async function poll (observe, description) {
  const deadline = Date.now() + 180000
  do {
    if (await observe()) return
    await I.wait(1)
  } while (Date.now() < deadline)
  throw new Error(`Timed out waiting for ${description}`)
}

function jobContainers () {
  const ids = docker('ps', '--all', '--quiet', '--filter', `label=io.digital-commons.e2e.run=${state.owner}`,
    '--filter', `label=com.gitlab.gitlab-runner.job.id=${state.job.id}`).trim()
  return ids ? JSON.parse(docker('inspect', ...ids.split('\n'))) : []
}

// Docker's view of the first job, which no GitLab page shows: its checkout
// helper has exited (exit 0) while its build container still runs.
function assertHelperStoppedBuildRunning () {
  const containers = jobContainers()
  assert.ok(containers.some(container => container.Id === state.helper && container.State.Status === 'exited' && container.State.ExitCode === 0),
    'The first job must keep its stopped checkout helper')
  assert.ok(containers.some(container => container.Id === state.build && container.State.Running),
    'The first job must keep its running build container')
}

storyboardStep(Given, 'the first project\'s job is running and still has to upload its artifact', async () => {
  state.root = await getRootHeaders()
  const pat = await createLambdaPersonalAccessToken('runner-cleanup', ['api'], state.root)
  state.tokenId = pat.id
  state.headers = { 'PRIVATE-TOKEN': pat.token }
  await isolateRunner()
  assert.match(docker('exec', state.service, 'cat', '/etc/gitlab-runner/config.toml'), /^concurrent = 1$/m,
    'Keep the single Docker job slot')
  state.first = await createFixtureProject('first-project')
  state.second = await createFixtureProject('second-project')
  state.runners.push(await registerScopedRunner(I, state.first.name, state.root))
  const committed = await freshPost(`${BASE_URL}/api/v4/projects/${state.first.id}/repository/commits`, {
    branch: 'main',
    commit_message: 'test: preserve the checkout helper',
    actions: [{ action: 'create', file_path: '.gitlab-ci.yml', content: fs.readFileSync(path.join(FIXTURES, 'gitlab-ci.yml'), 'utf8') }]
  }, state.headers)
  assert.equal(committed.status, 201)
  await poll(async () => {
    const jobs = await freshGet(`${BASE_URL}/api/v4/projects/${state.first.id}/jobs`, state.headers)
    state.job = jobs.data?.find(job => job.name === 'preserve-helper')
    if (state.job && ['failed', 'canceled'].includes(state.job.status)) throw new Error('The fixture job failed before registration')
    if (state.job?.status !== 'running') return false
    const containers = jobContainers()
    const helper = containers.find(container => container.State.Status === 'exited' && container.State.ExitCode === 0)
    const build = containers.find(container => container.Config.Labels['com.gitlab.gitlab-runner.type'] === 'build' && container.State.Running)
    if (!helper || !build) return false
    state.helper = helper.Id
    state.build = build.Id
    try { docker('exec', state.build, 'test', '-f', '/tmp/job-ready'); return true } catch (_) { return false }
  }, 'the real checkout helper and the running job barrier')
  assertHelperStoppedBuildRunning()
  await GitLabUserPage.loginAs(process.env.TASK_GITLAB_LAMBDA_USER, process.env.TASK_GITLAB_LAMBDA_PASSWORD)
  await jobLogFrame(I, 'first-job-running', state.first.name, state.job.id, {
    waitText: WAIT_LINE, height: JOB_CARD_HEIGHT, fold: SETUP_SECTIONS, masks: [SUFFIX_MASK], projectNames: []
  })
  // Twin: the job is still running, waiting in its script, with nothing uploaded yet.
  const trace = await getJobTrace(state.first.name, state.job.id, state.headers)
  assert.ok(trace.includes(WAIT_LINE), 'The job must be waiting inside its script')
  assert.ok(!trace.includes('Uploading artifacts'), 'The job must not have uploaded its artifact yet')
  const job = await freshGet(`${BASE_URL}/api/v4/projects/${state.first.id}/jobs/${state.job.id}`, state.headers)
  assert.equal(job.data.status, 'running')
})

storyboardStep(When, 'the second project registers its own runner', async () => {
  const runner = await registerScopedRunner(I, state.second.name, state.root)
  state.runners.push(runner)
  const verified = spawnSync(state.docker, ['exec', state.service, 'gitlab-runner', 'verify'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 })
  assert.equal(verified.status, 0)
  assert.equal(((verified.stdout + verified.stderr).match(/is valid/g) || []).length, 2, 'Both project runners must be valid')
  // Registering a runner must leave the other project's job containers alone.
  assertHelperStoppedBuildRunning()
  const registered = await freshGet(`${BASE_URL}/api/v4/runners/${runner.runnerId}`, state.root)
  assert.equal(registered.status, 200)
  assert.deepEqual(registered.data.tag_list, ['saas-linux-medium-amd64'])
  assert.deepEqual(registered.data.projects.map(project => project.id), [state.second.id], 'The runner belongs to the second project only')
  // As the card shows it: Offline, with no job run yet.
  assert.deepEqual(await getRunnerCard(runner.runnerId, state.root), { status: 'OFFLINE', jobCount: 0 })
  await runnersFrame(I, 'two-project-runners', state.second.name, {
    waitText: 'saas-linux-medium-amd64', height: 430, projectNames: [], textMasks: [SUFFIX_MASK]
  })
})

storyboardStep(Then, 'GitLab accepts the first job artifact and marks the job as passed', async () => {
  docker('exec', state.build, 'touch', '/tmp/job-release')
  await poll(async () => {
    const response = await freshGet(`${BASE_URL}/api/v4/projects/${state.first.id}/jobs/${state.job.id}`, state.headers)
    assert.equal(response.status, 200)
    if (['failed', 'canceled'].includes(response.data.status)) throw new Error(`The first job ${response.data.status}`)
    return response.data.status === 'success'
  }, 'successful native artifact upload')
  assert.equal(await getJobArtifact(state.first.name, state.job.id, 'result.txt', state.headers), 'The first job kept its helper.\n')
  await jobLogFrame(I, 'first-job-artifact-passed', state.first.name, state.job.id, {
    waitText: 'Job succeeded',
    height: JOB_CARD_HEIGHT,
    fold: [...SETUP_SECTIONS, 'Cleaning up project directory'],
    masks: [SUFFIX_MASK],
    projectNames: []
  })
})
