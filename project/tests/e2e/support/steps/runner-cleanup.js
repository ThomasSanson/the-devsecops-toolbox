/* global inject Given When Then Before After NodeFilter */
const { I, GitLabUserPage } = inject()
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const { storyboardStep, addStoryboardFrame, capturePageFrame } = require('../../../../../.config/codeceptjs/storyboard')
const { renderPreFrame } = require('../helpers/capturedOutput')
const { composeService } = require('../helpers/docker')
const {
  BASE_URL, getRootHeaders, createLambdaPersonalAccessToken, revokePersonalAccessToken,
  createProject, deleteProject
} = require('../helpers/gitlabApi')
const { freshGet, freshPost } = require('../helpers/http')
const { registerScopedRunner, teardownScopedRunner, cancelRedundantPipelines, maskPipelinePage, RUNNER_NET } = require('../helpers/pipelineRunner')

const FIXTURES = path.join(__dirname, '../../fixtures/runner-cleanup')
let state

Before(() => { state = { projects: [], runners: [], environment: {} } })
After(async () => {
  if (!state.directory) return
  let finished = !state.job
  try {
    for (const project of state.projects) await cancelRedundantPipelines(project.name, 0, state.root)
    if (state.job) {
      await poll(async () => {
        const response = await freshGet(`${BASE_URL}/api/v4/projects/${state.first.id}/jobs/${state.job.id}`, state.headers)
        return ['success', 'failed', 'canceled'].includes(response.data?.status)
      }, 'the fixture job to finish cancellation')
      finished = true
    }
    for (const runner of state.runners) await teardownScopedRunner(runner, state.root)
    for (const project of state.projects) await deleteProject(project.name, state.headers)
    if (state.tokenId) await revokePersonalAccessToken(state.tokenId, state.root)
  } finally {
    try {
      // Preserve a live job if GitLab cannot confirm its cancellation. Only
      // finished fixture jobs and our disposable service can be removed.
      if (finished && state.docker && state.owner) {
        const owned = docker('ps', '--all', '--quiet', '--filter', `label=io.digital-commons.e2e.run=${state.owner}`).trim()
        if (owned) docker('rm', '--force', '--volumes', ...owned.split('\n'))
      }
    } finally {
      for (const [key, value] of Object.entries(state.environment)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      fs.rmSync(state.directory, { recursive: true, force: true })
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

async function createFixtureProject () {
  const name = `e2e-runner-cleanup-${crypto.randomBytes(6).toString('hex')}`
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

async function captureContainers (name) {
  const format = '{{index .Config.Labels "com.gitlab.gitlab-runner.type"}} {{.State.Status}} exit={{.State.ExitCode}}'
  const command = `docker inspect --format '${format}' <helper> <build>`
  const output = docker('inspect', '--format', format, state.helper, state.build)
  await renderPreFrame(I, name, `$ ${command}\n${output}`, { colour: true })
}

storyboardStep(Given, 'two projects share a serial test runner and the first job must upload an artifact', async () => {
  state.root = await getRootHeaders()
  const pat = await createLambdaPersonalAccessToken('runner-cleanup', ['api'], state.root)
  state.tokenId = pat.id
  state.headers = { 'PRIVATE-TOKEN': pat.token }
  await isolateRunner()
  state.first = await createFixtureProject()
  state.second = await createFixtureProject()
  const file = path.join(FIXTURES, 'gitlab-ci.yml')
  state.pipeline = fs.readFileSync(file, 'utf8')
  const output = execFileSync('cat', [file], { encoding: 'utf8' })
  const config = docker('exec', state.service, 'cat', '/etc/gitlab-runner/config.toml')
  assert.match(config, /^concurrent = 1$/m, 'Keep the single Docker job slot')
  await renderPreFrame(I, 'serial-runner-and-artifact', `$ cat config.toml\n${config}\n$ cat .gitlab-ci.yml\n${output}`, { colour: true })
})

storyboardStep(When, 'the first job is running while its checkout helper is stopped', async () => {
  state.runners.push(await registerScopedRunner(I, state.first.name, state.root))
  const committed = await freshPost(`${BASE_URL}/api/v4/projects/${state.first.id}/repository/commits`, {
    branch: 'main',
    commit_message: 'test: preserve the checkout helper',
    actions: [{ action: 'create', file_path: '.gitlab-ci.yml', content: state.pipeline }]
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
  await captureContainers('live-job-stopped-helper')
})

storyboardStep(When, 'the second project registers its own runner without restarting the first job', async () => {
  state.runners.push(await registerScopedRunner(I, state.second.name, state.root))
  const verified = spawnSync(state.docker, ['exec', state.service, 'gitlab-runner', 'verify'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 })
  assert.equal(verified.status, 0)
  const raw = verified.stdout + verified.stderr
  assert.equal((raw.match(/is valid/g) || []).length, 2, 'Both project runners must be valid')
  const colour = String.fromCharCode(27) + '\\[[0-9;]*m'
  const masked = ['pid', 'correlation_id', 'runner', 'runner_name'].reduce((text, field) =>
    text.replace(new RegExp('(' + field + '(?:' + colour + ')*=)\\S+', 'g'), '$1<value>'), raw)
  await renderPreFrame(I, 'two-project-runners', '$ gitlab-runner verify\n' + masked, { colour: true })
})

storyboardStep(Then, 'the first job still has its stopped checkout helper and its running build container', async () => {
  const containers = jobContainers()
  assert.ok(containers.some(container => container.Id === state.helper && container.State.Status === 'exited'),
    'Registering the second runner must preserve the first job checkout helper')
  assert.ok(containers.some(container => container.Id === state.build && container.State.Running),
    'Registering the second runner must preserve the running build container')
  await captureContainers('helper-survives-registration')
})

storyboardStep(Then, 'GitLab accepts the first job artifact and marks the job as passed', async () => {
  docker('exec', state.build, 'touch', '/tmp/job-release')
  await poll(async () => {
    const response = await freshGet(`${BASE_URL}/api/v4/projects/${state.first.id}/jobs/${state.job.id}`, state.headers)
    assert.equal(response.status, 200)
    if (['failed', 'canceled'].includes(response.data.status)) throw new Error(`The first job ${response.data.status}`)
    return response.data.status === 'success'
  }, 'successful native artifact upload')
  let artifact
  try {
    artifact = execFileSync('curl', ['--fail', '--silent', '-H', `PRIVATE-TOKEN: ${state.headers['PRIVATE-TOKEN']}`,
      `${BASE_URL}/api/v4/projects/${state.first.id}/jobs/${state.job.id}/artifacts/result.txt`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (_) {
    // execFileSync includes its arguments in errors; the PAT must stay private.
    throw new Error('Could not download the fixture job artifact')
  }
  assert.equal(artifact, 'The first job kept its helper.\n')
  await GitLabUserPage.loginAs(process.env.TASK_GITLAB_LAMBDA_USER, process.env.TASK_GITLAB_LAMBDA_PASSWORD)
  await I.amOnPage(`/${process.env.TASK_GITLAB_LAMBDA_USER}/${state.first.name}/-/jobs/${state.job.id}`)
  await I.waitForText('Job succeeded', 60)
  await maskPipelinePage(I, state.first.name)
  await I.executeScript(() => {
    // Keep the complete user script and artifact upload; fold only the native
    // executor setup with GitLab's own controls, as in the hybrid CI story.
    document.querySelectorAll('.job-log-line-header').forEach(header => {
      if (!header.textContent.includes('step_script') && !header.textContent.includes('Uploading artifacts') &&
          header.querySelector('[data-testid="chevron-lg-down-icon"]')) header.click()
    })
    document.querySelectorAll('.job-log-line-number, .job-log-time, .job-log-line-header .badge')
      .forEach(element => { element.style.display = 'none' })
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    nodes.forEach(node => {
      node.nodeValue = node.nodeValue.replace(/\b[0-9a-f]{8,}\b/g, '<sha>')
        .replace(/\bid=\d+/g, 'id=<job>').replace(/\btoken=\S+/g, 'token=<masked>')
        .replace(/\b\d+(?:\.\d+)?s\b/g, '<duration>')
        .replace(/\brunner-[\w-]+-project-\d+-concurrent-[\w-]+/g, '<runner>')
    })
    // GitLab splits log fields across coloured spans. Match the actual line
    // across those spans and replace only volatile values, keeping every node
    // and its native colour in place.
    function maskLine (line, pattern, replacement) {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
      const parts = []
      let text = ''
      while (walker.nextNode()) {
        parts.push({ node: walker.currentNode, start: text.length })
        text += walker.currentNode.nodeValue
      }
      for (const match of [...text.matchAll(pattern)].reverse()) {
        const start = match.index
        const end = start + match[0].length
        const masked = match[0].replace(pattern, replacement)
        for (const part of parts) {
          const length = part.node.nodeValue.length
          const left = Math.max(0, start - part.start)
          const right = Math.min(length, end - part.start)
          if (left >= right) continue
          part.node.nodeValue = part.node.nodeValue.slice(0, left) +
            (part.start <= start ? masked : '') + part.node.nodeValue.slice(right)
        }
      }
    }
    document.querySelectorAll('.js-log-line.job-log-line').forEach(line => {
      maskLine(line, /(\bon )[^,\n]+(, system ID: )\S+/g, '$1<runner>$2<system>')
      maskLine(line, /UUID: [\w<>-]+/g, 'UUID: <uuid>')
      maskLine(line, /\bcorrelation_id=\S+/g, 'correlation_id=<id>')
      maskLine(line, /\bid=\d+/g, 'id=<job>')
      maskLine(line, /\btoken=\S+/g, 'token=<masked>')
    })
    window.scrollTo(0, 0)
  })
  await addStoryboardFrame(I, await capturePageFrame(I, 'first-job-artifact-passed'))
})
