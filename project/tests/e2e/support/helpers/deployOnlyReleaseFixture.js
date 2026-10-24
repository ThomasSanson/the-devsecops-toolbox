const assert = require('assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { REPO } = require('./frameworkCopy')
const { syncFixture, write, git, runTask } = require('./deployOnlyFixture')
const { primePipelineGraphIds } = require('./deployOnlyGraphFixture')
const { BASE_URL, getRootHeaders, createProjectRunner, deleteRunner, createProjectVariable, listPipelineJobs, listProjectPipelines, createMergeRequestWhenBranchExists } = require('./gitlabApi')
const { freshGet, freshPost, freshPut } = require('./http')
const { cancelRedundantPipelines, startIsolatedRunnerService, RUNNER_NET } = require('./pipelineRunner')

function docker (...args) {
  try {
    return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 })
  } catch (_) {
    throw new Error(`The release scheduling fixture's Docker ${args[0]} operation failed`)
  }
}

async function waitFor (read, matches, message, timeout = 240000) {
  const deadline = Date.now() + timeout
  do {
    const value = await read()
    if (matches(value)) return value
    await new Promise(resolve => setTimeout(resolve, 1000))
  } while (Date.now() < deadline)
  throw new Error(message)
}

async function setup () {
  await primePipelineGraphIds()
  const state = await syncFixture('/tmp/e2e-deploy-only-release')
  state.owner = crypto.randomBytes(8).toString('hex')
  state.runners = []
  state.api = `${BASE_URL}/api/v4/projects/${state.pub.projectId}`
  state.jobs = async id => {
    const result = await listPipelineJobs(state.pub.projectName, id, state.pub.headers)
    assert.equal(result.status, 200)
    return result.data
  }
  state.head = async () => {
    const result = await freshGet(`${state.api}/repository/branches/trunk`, state.pub.headers)
    assert.equal(result.status, 200)
    return result.data.commit.id
  }
  try {
    const variable = await createProjectVariable(state.pub.projectName, {
      key: 'TASK_COMMITIZEN_TOKEN',
      value: state.env.TASK_COMMITIZEN_TOKEN,
      masked: true,
      protected: false,
      raw: true
    }, state.pub.headers)
    assert.equal(variable.status, 201)
    fs.copyFileSync(path.join(REPO, 'project/tests/e2e/support/fixtures/deploy_only_barrier.py'), path.join(state.dir, 'barrier.py'))
    write(state.dir, 'deploy/image.yaml', 'image: app:1\n')
    write(state.dir, '.gitlab-ci.yml', `stages: [plan, release]
include:
  - local: .config/gitlab/ci/workflow.yml
  - local: .config/gitlab/ci/variables.yml
  - local: .config/gitlab/ci/devsecops/plan.yml
  - local: .config/gitlab/ci/devsecops/release.yml
variables:
  TASK_DEVSECOPS_DEPLOY_ONLY_REGEXP: '\\A(?!(?:deploy/))'
.docker-job:
  image: python:3.13-alpine
plan:
  tags: [plan-order]
  script: python barrier.py plan
release:
  tags: [release-order]
  script: python barrier.py release
  after_script: []
tag-probe:
  stage: release
  image: python:3.13-alpine
  tags: [release-order]
  script: echo staging
  rules:
    - if: '$CI_COMMIT_TAG == "staging"'
`)
    git(state.dir, 'add', '-A')
    git(state.dir, 'commit', '-qm', 'test: preserve real plan and release scheduling rules')
    state.sha = git(state.dir, 'rev-parse', 'HEAD')
    state.pub.push('trunk')
    state.pipeline = await waitFor(async () => {
      const result = await listProjectPipelines(state.pub.projectName, state.pub.headers)
      return result.data.find(item => item.sha === state.sha && item.source === 'push')
    }, Boolean, 'The default-branch push must create a pipeline')
    const root = await getRootHeaders()
    // Two runners matter: one busy plan runner must not accidentally hold release.
    for (const tag of ['plan-order', 'release-order']) {
      const created = await createProjectRunner(state.pub.projectId, root, [tag])
      assert.equal(created.status, 201)
      state.runners.push(created.data.id)
      assert.equal((await freshPut(`${BASE_URL}/api/v4/runners/${created.data.id}`, { run_untagged: false }, root)).status, 200)
      const service = startIsolatedRunnerService(`e2e-${tag}-${state.owner}`, state.owner)
      docker('exec', service, 'gitlab-runner', 'register', '--non-interactive', '--url', BASE_URL,
        '--token', created.data.token, '--executor', 'docker', '--docker-image', 'python:3.13-alpine',
        '--docker-network-mode', RUNNER_NET, '--docker-privileged=false')
      docker('kill', '-s', 'HUP', service)
    }
    return state
  } catch (error) {
    await teardown(state)
    throw error
  }
}

async function held (state, pipeline) {
  const jobs = await waitFor(() => state.jobs(pipeline.id), rows => rows.some(row => row.name === 'plan' && row.status === 'running'), 'Plan must reach the controlled barrier')
  const release = jobs.find(job => job.name === 'release')
  assert.equal(release.started_at, null, 'Release must not start while plan is running')
  assert.equal(release.status, 'created', 'Release must wait for plan, even when its own runner is available')
  assert.equal(await state.head(), pipeline.sha, 'Release must not advance the branch during plan')
  return jobs
}

async function finish (state, pipeline, result) {
  const opened = await createProjectVariable(state.pub.projectName, { key: `BARRIER_${pipeline.id}`, value: String(result), raw: true }, state.pub.headers)
  assert.equal(opened.status, 201)
  const jobs = await waitFor(() => state.jobs(pipeline.id), rows => rows.find(row => row.name === 'release')?.status === 'success', 'Release must run after plan finishes, including after failure')
  const plan = jobs.find(job => job.name === 'plan')
  const release = jobs.find(job => job.name === 'release')
  assert.equal(plan.status, result ? 'failed' : 'success')
  assert.ok(Date.parse(release.started_at) >= Date.parse(plan.finished_at))
  assert.notEqual(await state.head(), pipeline.sha)
  return jobs
}

async function trigger (state) {
  const result = await freshPost(`${state.api}/pipeline`, { ref: 'trunk' }, state.pub.headers)
  assert.equal(result.status, 201, JSON.stringify(result.data))
  return result.data
}

async function obsoletePlan (state, sha) {
  const result = runTask({ ...state, env: { ...state.env, CI_COMMIT_SHA: sha } }, 'plan')
  assert.notEqual(result.status, 0)
  assert.ok((result.stdout + result.stderr).includes('obsolete'))
}

async function withoutPlan (state) {
  // The fixture's local tree still has the unchanged deployment file.
  git(state.dir, 'checkout', '-qb', 'promotion')
  write(state.dir, 'deploy/image.yaml', 'image: app:2\n')
  git(state.dir, 'add', 'deploy/image.yaml')
  git(state.dir, 'commit', '-qm', 'chore: promote image')
  state.pub.push('promotion')
  const mr = await createMergeRequestWhenBranchExists(state.pub.projectName, { source_branch: 'promotion', target_branch: 'trunk', title: 'Promote image' }, state.pub.headers)
  assert.equal(mr.status, 201)
  const pipeline = await waitFor(async () => {
    const response = await freshGet(`${state.api}/merge_requests/${mr.data.iid}/pipelines`, state.pub.headers)
    return response.data[0]
  }, Boolean, 'An MR without plan must create a valid pipeline')
  const jobs = await waitFor(() => state.jobs(pipeline.id), rows => rows.some(row => row.name === 'release' && row.status === 'success'), 'MR release must run without plan')
  assert.deepEqual(jobs.map(job => job.name), ['release'])
  return pipeline
}

async function staging (state) {
  const tag = await freshPost(`${state.api}/repository/tags`, { tag_name: 'staging', ref: 'trunk' }, state.pub.headers)
  assert.equal(tag.status, 201)
  const pipeline = await waitFor(async () => {
    const result = await listProjectPipelines(state.pub.projectName, state.pub.headers, '?ref=staging')
    return result.data[0]
  }, Boolean, 'The staging probe pipeline must be created')
  assert.deepEqual((await state.jobs(pipeline.id)).map(job => job.name), ['tag-probe'])
}

async function teardown (state) {
  if (!state) return
  const root = await getRootHeaders()
  await cancelRedundantPipelines(state.pub.projectName, 0, root)
  for (const runner of state.runners) await deleteRunner(runner, root)
  const owned = docker('ps', '--all', '--quiet', '--filter', `label=io.digital-commons.e2e.run=${state.owner}`).trim()
  if (owned) docker('rm', '--force', '--volumes', ...owned.split('\n'))
  await state.pub.teardown()
}

async function web (state) {
  const response = await freshPost(`${BASE_URL}/api/graphql`, {
    // GitLab's UI uses this operation name to create source=web pipelines.
    operationName: 'internalPipelineCreate',
    query: 'mutation internalPipelineCreate($input: PipelineCreateInput!) { pipelineCreate(input: $input) { pipeline { id } errors } }',
    variables: { input: { projectPath: `${process.env.TASK_GITLAB_LAMBDA_USER}/${state.pub.projectName}`, ref: 'trunk' } }
  }, state.pub.headers)
  assert.equal(response.status, 200)
  assert.deepEqual(response.data.data?.pipelineCreate?.errors, [], JSON.stringify(response.data))
  const id = response.data.data.pipelineCreate.pipeline.id.split('/').pop()
  const pipeline = await freshGet(`${state.api}/pipelines/${id}`, state.pub.headers)
  assert.equal(pipeline.data.source, 'web')
  return pipeline.data
}

async function scheduled (state, flag) {
  const schedule = await freshPost(`${state.api}/pipeline_schedules`, {
    description: `Ordering proof ${flag}`, ref: 'trunk', cron: '0 0 1 1 *', cron_timezone: 'UTC', active: false
  }, state.pub.headers)
  assert.equal(schedule.status, 201)
  const endpoint = `${state.api}/pipeline_schedules/${schedule.data.id}`
  assert.equal((await freshPost(`${endpoint}/variables`, { key: flag, value: '1', variable_type: 'env_var' }, state.pub.headers)).status, 201)
  assert.equal((await freshPost(`${endpoint}/play`, {}, state.pub.headers)).status, 201)
  return waitFor(async () => {
    const result = await freshGet(endpoint, state.pub.headers)
    return result.data.last_pipeline
  }, Boolean, 'Playing the schedule must create its pipeline')
}

async function serialization (state, first) {
  const second = await trigger(state)
  await waitFor(() => state.jobs(second.id), rows => rows.some(job => job.name === 'plan' && job.status === 'waiting_for_resource'), 'A second plan must wait for the dedicated resource group')
  assert.equal((await state.jobs(first.id)).find(job => job.name === 'plan').status, 'running')
  await finish(state, first, 0)
  const jobs = await waitFor(() => state.jobs(second.id), rows => rows.some(job => job.name === 'plan' && job.status === 'running'), 'The second plan must acquire the released lock')
  assert.equal(jobs.find(job => job.name === 'release').started_at, null)
  await obsoletePlan(state, second.sha)
  await finish(state, second, 1)
}

module.exports = { setup, held, finish, trigger, obsoletePlan, withoutPlan, staging, teardown, waitFor, web, scheduled, serialization }
