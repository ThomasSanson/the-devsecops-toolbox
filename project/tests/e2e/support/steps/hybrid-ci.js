/* global inject Given When Then Before After NodeFilter */
const assert = require('assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { I, GitLabUserPage } = inject()
const { prepareVersionedTemplate, renderProjectFromTemplate, updateProject, removeRendered, UPDATE_MARKER, UPDATE_MARKER_FILE } = require('../helpers/copierRender')
const { renderPreFrame } = require('../helpers/capturedOutput')
const { storyboardStep, addStoryboardFrame, capturePageFrame, captureElementFrame } = require('../../../../../.config/codeceptjs/storyboard')
const {
  getRootHeaders, createProject, deleteProject, createLambdaPersonalAccessToken,
  revokePersonalAccessToken, lintProjectCi, createProjectRunner, deleteRunner,
  createMergeRequest, listPipelineJobs, getPipeline, BASE_URL, encodedProjectPath
} = require('../helpers/gitlabApi')
const { maskPipelinePage, cancelRedundantPipelines, PIPELINE_TIMEOUT_MS } = require('../helpers/pipelineRunner')
const { freshGet, freshPut } = require('../helpers/http')
const { composeService, stripAnsiEscapeSequences } = require('../helpers/docker')

const DOCKER_TAG = 'saas-linux-medium-amd64'
// Build the deliberately unknown words without teaching the toolbox dictionary
// to accept them. Only the generated project's dictionary accepts PROJECT_WORD.
const PROJECT_WORD = ['hybrid', 'ci', 'word'].join('')
const MISSPELLING = 'spelling'.replace('ll', 'lll')
const SECURITY_FILE = 'project/code/transport.js'
const INSECURE_URL = ['http:', '', 'example.org/health'].join('/')
const FILE_CHECKS = ['code:commitlint', 'code:commitizen-check', 'code:commitizen-bump-dry',
  'code:lizard', 'code:renovate-validate', 'code:betterleaks', 'code:megalinter', 'code:all', 'no-cheat']
const PROJECT_JOBS = ['code:project', 'plan', 'build', 'test', 'release', 'deploy', 'operate', 'monitor', 'feedback']
let state

// Reuse Copier's already pinned Python environment; no extra test dependency.
function loadYaml (input) {
  return JSON.parse(execFileSync('uvx', ['--python', '3.14', '--from', 'copier==9.14.3',
    'python', '-c', 'import json, sys, yaml; print(json.dumps(yaml.safe_load(sys.stdin.read())))'],
  { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }))
}

Before(() => { state = { runners: [], runtime: new Map() } })
After(async () => {
  if (!state.projectName && !state.dir && !state.template) return
  if (state.projectName || state.tokenId) {
    const headers = await getRootHeaders()
    if (state.projectName) await cancelRedundantPipelines(state.projectName, 0, headers)
    for (const runner of state.runners) {
      try { docker('exec', runner.service, 'gitlab-runner', 'unregister', '--url', 'http://gitlab', '--token', runner.token) } catch (_) {} // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
      await deleteRunner(runner.id, headers)
    }
    if (state.projectName) await deleteProject(state.projectName, headers)
    if (state.tokenId) await revokePersonalAccessToken(state.tokenId, headers)
  }
  removeRendered(state.dir)
  removeRendered(state.template)
})

function git (...args) {
  return execFileSync('git', ['-C', state.dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function docker (...args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 })
}

function push () {
  try {
    git('push', '--quiet', state.remote, 'HEAD:refs/heads/feat/hybrid-runner-proof')
  } catch (_) {
    throw new Error('Could not push the hybrid runner proof branch')
  }
}

async function publishProject () {
  const root = await getRootHeaders()
  state.projectName = `e2e-hybrid-ci-${crypto.randomBytes(4).toString('hex')}`
  const pat = await createLambdaPersonalAccessToken(state.projectName, ['api', 'write_repository'], root)
  state.token = pat.token
  state.tokenId = pat.id
  state.headers = { 'PRIVATE-TOKEN': state.token }
  const created = await createProject({
    name: state.projectName,
    visibility: 'public',
    initialize_with_readme: false,
    shared_runners_enabled: false,
    group_runners_enabled: false
  }, state.headers)
  assert.ok(created.status < 400, `Project creation returned ${created.status}`)
  state.projectId = created.data.id
  git('config', 'core.hooksPath', '/dev/null')
  const user = process.env.TASK_GITLAB_LAMBDA_USER
  state.remote = `http://${user}:${encodeURIComponent(state.token)}@gitlab/${user}/${state.projectName}.git` // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
  try {
    git('push', '--quiet', state.remote, 'HEAD:refs/heads/main')
  } catch (_) {
    throw new Error('Could not push the generated hybrid CI project')
  }
}

storyboardStep(Given, 'I generate a self-hosted project using the saas-linux-medium-amd64 Docker runner tag', async () => {
  state.template = prepareVersionedTemplate()
  state.dir = renderProjectFromTemplate(state.template, '1.0.0', {
    ci_platform: 'gitlab_self_hosted',
    gitlab_docker_runner_tags: JSON.stringify([DOCKER_TAG]),
    gitlab_docker_host: 'tcp://docker:2376',
    gitlab_docker_tls_certdir: '/certs',
    devsecops_automerge: false
  })
  const tags = fs.readFileSync(`${state.dir}/.config/gitlab/ci/tags.yml`, 'utf8')
  assert.deepEqual(loadYaml(tags)['.default-tags'].tags, [DOCKER_TAG],
    'Copier must preserve the selected Docker runner tags in self-hosted mode')
  try {
    execFileSync('task', ['yamllint', 'TASK_YAMLLINT_PATH_TO_LINT=.config/devsecops/.copier-answers.yml .config/gitlab/ci/services.yml .config/gitlab/ci/variables.yml'],
      { cwd: state.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    throw new Error(`Generated runner settings must pass the YAML rules:\n${stripAnsiEscapeSequences(String(error.stdout || '') + String(error.stderr || ''))}`)
  }
  await renderPreFrame(I, 'docker-runner-selection', `$ cat .config/gitlab/ci/tags.yml\n${tags}`)
  await publishProject()
})

storyboardStep(Then, 'GitLab validates the complete generated pipeline', async () => {
  const lint = await lintProjectCi(state.projectName, state.headers)
  assert.equal(lint.data.valid, true, JSON.stringify(lint.data.errors))
  const config = loadYaml(lint.data.merged_yaml)
  assert.deepEqual(config.services || [], [], 'The pipeline must not start a global Docker service')
  assert.deepEqual(config.default?.services || [], [], 'Default services must not start Docker')
  for (const name of FILE_CHECKS) {
    assert.deepEqual(config[name].tags || [], [], `${name} must use the untagged runner`)
    assert.deepEqual(config[name].services || [], [], `${name} must run without a container engine`)
  }
  for (const name of PROJECT_JOBS) {
    assert.deepEqual(config[name].tags, [DOCKER_TAG], `${name} must retain its Docker runner`)
    assert.ok(config[name].services.some(service => service.name === 'docker:29-dind'), `${name} needs DinD`)
  }
  assert.equal(config['code:betterleaks'].variables.TASK_BETTERLEAKS_MODE, 'binary')
  const version = JSON.parse(fs.readFileSync(`${state.dir}/.config/megalinter/package.json`, 'utf8')).dependencies['mega-linter-runner']
  assert.equal(config['code:megalinter'].image.name, `ghcr.io/oxsecurity/megalinter:v${version}`)
  assert.deepEqual(config['code:megalinter'].before_script, ['.config/task/install.sh'],
    'MegaLinter needs only Task to preserve the project environment settings')
  assert.ok(config['code:megalinter'].artifacts.paths.includes('megalinter-reports/'))
  await GitLabUserPage.loginAs(process.env.TASK_GITLAB_LAMBDA_USER, process.env.TASK_GITLAB_LAMBDA_PASSWORD)
  await I.amOnPage(`/${process.env.TASK_GITLAB_LAMBDA_USER}/${state.projectName}/-/ci/editor`)
  await I.waitForText('Pipeline syntax is correct', 60)
  await I.executeScript(() => {
    const text = Array.from(document.querySelectorAll('span, p, div'))
      .find(el => el.textContent.trim().length <= 140 && el.textContent.includes('Pipeline syntax is correct'))
    if (!text) throw new Error('GitLab syntax verdict was not found')
    let box = text
    for (let i = 0; i < 3 && box.parentElement; i++) {
      if (box.querySelector('svg')) break
      box = box.parentElement
    }
    box.id = 'hybrid-ci-valid'
  })
  await addStoryboardFrame(I, await captureElementFrame(I, 'generated-pipeline-valid', '#hybrid-ci-valid'))
})

storyboardStep(When, 'I add the web application without changing the generated pipeline', async () => {
  const pipeline = fs.readFileSync(`${state.dir}/.gitlab-ci.yml`, 'utf8')
  assert.ok(!pipeline.includes('project/gitlab-ci.yml'), 'The generated pipeline must not include a project CI extension')
  fs.cpSync(path.join(__dirname, '../../fixtures/hybrid-ci/project'), `${state.dir}/project`, { recursive: true })
  assert.equal(fs.readFileSync(`${state.dir}/.gitlab-ci.yml`, 'utf8'), pipeline)
  assert.ok(!fs.existsSync(`${state.dir}/project/gitlab-ci.yml`), 'The project must use the generated pipeline directly')
  fs.appendFileSync(`${state.dir}/.env.dist`, '\nTASK_MEGALINTER_CONFIG=project/quality/megalinter.yml\n')
  fs.writeFileSync(`${state.dir}/project/README.md`, `# Web application\n\n${PROJECT_WORD} ${MISSPELLING}\n`)
  fs.writeFileSync(`${state.dir}/${SECURITY_FILE}`, `module.exports = '${INSECURE_URL}'\n`)
  fs.writeFileSync(`${state.dir}/.config/cspell/config.project.json`, JSON.stringify({ version: '0.2', words: [PROJECT_WORD] }, null, 2) + '\n')
  git('switch', '--quiet', '-c', 'feat/hybrid-runner-proof')
  git('add', '-A')
  git('commit', '--quiet', '-m', 'feat: demonstrate separate runners for checks and containers')
  push()
  const mr = await createMergeRequest(state.projectName, {
    source_branch: 'feat/hybrid-runner-proof',
    target_branch: 'main',
    title: 'Run file checks and the web application on separate runners'
  }, state.headers)
  assert.ok(mr.status < 400, `Merge request creation returned ${mr.status}`)
  state.mr = mr.data.iid
  const lint = await lintProjectCi(state.projectName, state.headers, 'feat/hybrid-runner-proof')
  assert.equal(lint.data.valid, true, JSON.stringify(lint.data.errors))
  const code = loadYaml(lint.data.merged_yaml)['code:project']
  assert.deepEqual(code.tags, [DOCKER_TAG], 'Project tasks must retain the selected Docker runner')
  assert.ok(code.services.some(service => service.name === 'docker:29-dind'), 'Project tasks must retain DinD')
  assert.equal(code.variables.DOCKER_HOST, 'tcp://docker:2376')
  const content = fs.readFileSync(`${state.dir}/project/Taskfile.yml`, 'utf8')
  await renderPreFrame(I, 'project-tasks-keep-docker', `$ cat project/Taskfile.yml\n${content}`)
})

async function registerRunner (privileged) {
  const headers = await getRootHeaders()
  const created = await createProjectRunner(state.projectId, headers, privileged ? [DOCKER_TAG] : [])
  assert.ok(created.status < 400, `Runner creation returned ${created.status}`)
  const runner = { id: created.data.id, token: created.data.token, service: composeService('gitlab-runner'), privileged }
  state.runners.push(runner)
  const configured = await freshPut(`${BASE_URL}/api/v4/runners/${runner.id}`, {
    run_untagged: !privileged, description: privileged ? 'Docker jobs' : 'Unprivileged file checks'
  }, headers)
  assert.equal(configured.status, 200)
  const args = ['exec', runner.service, 'gitlab-runner', 'register', '--non-interactive',
    '--url', 'http://gitlab', '--token', runner.token, '--executor', 'docker', // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
    '--docker-image', 'alpine:3.20', '--docker-network-mode', 'the-devsecops-toolbox_the-devsecops-toolbox',
    `--docker-privileged=${privileged}`]
  if (privileged) args.push('--docker-volumes', '/certs/client')
  try { docker(...args) } catch (_) { throw new Error(`Registration failed for project runner ${runner.id}`) }
  docker('kill', '-s', 'HUP', runner.service)
  return runner
}

storyboardStep(Then, 'my project has its own lint settings and two mistakes to catch', async () => {
  const files = ['project/README.md', SECURITY_FILE, '.config/cspell/config.project.json', 'project/quality/megalinter.yml']
  const content = execFileSync('cat', files, { cwd: state.dir, encoding: 'utf8' })
  const command = ['cat', ...files.map(file => `  ${file}`)].join(' \\\n')
  await renderPreFrame(I, 'project-lint-settings', `$ ${command}\n${content}`)
})

function trace (job) {
  const auth = Object.entries(state.headers).flatMap(([key, value]) => ['-H', `${key}: ${value}`])
  try {
    return execFileSync('curl', ['--fail', '--silent', ...auth,
      `${BASE_URL}/api/v4/projects/${state.projectId}/jobs/${job.id}/trace`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (_) {
    throw new Error(`Could not read the trace of job ${job.id}`)
  }
}

function observeRuntime (jobs) {
  for (const job of jobs.filter(job => job.status === 'running' && !state.runtime.has(job.id))) {
    const ids = docker('ps', '--quiet', '--filter', `label=com.gitlab.gitlab-runner.job.id=${job.id}`, '--filter', 'label=com.gitlab.gitlab-runner.type=build').trim()
    if (!ids) continue
    const containers = JSON.parse(docker('inspect', ...ids.split('\n')))
    state.runtime.set(job.id, containers.map(container => ({
      privileged: container.HostConfig.Privileged,
      image: container.Config.Image,
      dockerSocket: container.Mounts.some(mount => mount.Destination === '/var/run/docker.sock')
    })))
  }
}

async function runPipeline () {
  const root = await getRootHeaders()
  const deadline = Date.now() + PIPELINE_TIMEOUT_MS
  let id
  let previous = ''
  while (Date.now() < deadline) {
    if (!id) {
      const response = await freshGet(`${BASE_URL}/api/v4/projects/${encodedProjectPath(state.projectName)}/merge_requests/${state.mr}/pipelines`, state.headers)
      id = response.data.find(pipeline => pipeline.id > (state.pipelineId || 0))?.id
      if (id) await cancelRedundantPipelines(state.projectName, id, root)
    }
    if (id) {
      const pipeline = await getPipeline(state.projectName, id, state.headers)
      const jobs = (await listPipelineJobs(state.projectName, id, state.headers)).data
      const progress = jobs.map(job => `${job.name}=${job.status}`).join(', ')
      if (progress !== previous) { console.log(`Hybrid pipeline ${id}: ${progress}`); previous = progress }
      observeRuntime(jobs)
      if (['success', 'failed', 'canceled'].includes(pipeline.data.status)) {
        state.pipelineId = id
        state.jobs = jobs
        savePipelineEvidence(id, jobs)
        console.log(`Hybrid pipeline ${id}: ${pipeline.data.status}; ${jobs.map(job => `${job.name}=${job.status}`).join(', ')}`)
        return pipeline.data.status
      }
    }
    await I.wait(3)
  }
  throw new Error('The hybrid pipeline did not reach a terminal state')
}

function job (name) {
  const found = state.jobs.find(job => job.name === name)
  assert.ok(found, `Missing job ${name}`)
  return found
}

function savePipelineEvidence (id, jobs) {
  const directory = path.join(__dirname, '../../_output/hybrid-ci', String(id))
  fs.mkdirSync(directory, { recursive: true })
  const summary = jobs.map(job => ({
    id: job.id,
    name: job.name,
    status: job.status,
    duration: job.duration,
    queuedDuration: job.queued_duration,
    runnerId: job.runner?.id,
    runnerDescription: job.runner?.description,
    runtime: state.runtime.get(job.id)
  }))
  fs.writeFileSync(path.join(directory, 'jobs.json'), JSON.stringify(summary, null, 2) + '\n')
  for (const current of jobs) fs.writeFileSync(path.join(directory, `${current.id}.log`), trace(current))
}

async function captureJob (name, frame) {
  const current = job(name)
  I.resizeWindow(1440, 1000)
  await I.amOnPage(`/${process.env.TASK_GITLAB_LAMBDA_USER}/${state.projectName}/-/jobs/${current.id}`)
  await I.waitForElement('[data-testid="job-log-content"]', 60)
  await I.waitForText(current.status === 'success' ? 'Job succeeded' : 'Job failed', 60)
  await maskPipelinePage(I, state.projectName, { keepContext: true })
  if (name === 'code:megalinter' || name === 'test') {
    const expanded = name === 'test' ? 'Executing "step_script"' : 'Preparing the "docker" executor'
    await I.waitForText(name === 'test' ? '$ task test' : '$ task megalinter:ci', 60)
    // Use GitLab's own folding controls. Keep the relevant section expanded
    // and retain every other section header and the job verdict.
    await I.executeScript(expanded => {
      document.querySelectorAll('.job-log-line-header').forEach(header => {
        if (!header.textContent.includes(expanded) &&
            header.querySelector('[data-testid="chevron-lg-down-icon"]')) header.click()
      })
    }, expanded)
    await I.waitForFunction(expanded => Array.from(document.querySelectorAll('.job-log-line-header'))
      .every(header => header.textContent.includes(expanded) ||
        !header.querySelector('[data-testid="chevron-lg-down-icon"]')), [expanded], 15)
  }
  await I.executeScript(({ projectName, command, showImage }) => {
    // Same-stage jobs finish in a different order on each run. Retain all
    // native jobs and statuses, with a stable name order for the screenshot.
    document.querySelectorAll('.builds-container').forEach(container => {
      Array.from(container.querySelectorAll('.build-job'))
        .sort((left, right) => left.textContent.localeCompare(right.textContent))
        .forEach(job => job.parentElement.appendChild(job))
    })
    // Collapse only the runner bootstrap, before the user's task begins. Keep
    // its entire output: a screenshot must never pick just the passing lines.
    const lines = Array.from(document.querySelectorAll('.js-log-line.job-log-line'))
    const start = lines.findIndex(line => line.textContent.includes(command))
    if (!showImage && start < 0) throw new Error(`The job log does not contain ${command}`)
    if (!showImage && start > 0) lines.slice(0, start).forEach(line => { line.style.display = 'none' })
    document.querySelectorAll('.job-log-line-number, .job-log-time, .job-log-line-header .badge, [class*="log-line-timestamp"], [class*="line-timestamp"]')
      .forEach(element => { element.style.display = 'none' })
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    nodes.forEach(node => {
      node.nodeValue = node.nodeValue.replaceAll(projectName, 'hybrid-ci-demo')
        .replace(/\b[0-9a-f]{8,}\b/g, '<sha>')
        .replace(/\b\d+(?:\.\d+)?s\b/g, '<duration>')
        .replace(/(gitlab-runner )\d+\.\d+\.\d+/g, '$1<version>')
        .replace(/(on .+ )\S+(, system ID: )\S+/g, '$1<runner>$2<system>')
        .replace(/UUID: [\w<>-]+/g, 'UUID: <uuid>')
        .replace(/\brunner-[\w-]+-project-\d+-concurrent-[\w-]+/g, '<runner>')
    })
  }, {
    projectName: state.projectName,
    command: name === 'code:commitlint' ? '$ task commitlint' : name === 'code:megalinter' ? '$ task megalinter:ci' : '$ task test',
    showImage: name === 'code:megalinter'
  })
  await I.executeScript(() => {
    let element = document.querySelector('[data-testid="job-log-content"]')
    while (element) {
      element.scrollTop = 0
      element = element.parentElement
    }
    window.scrollTo(0, 0)
  })
  await I.waitForFunction(() => {
    const first = Array.from(document.querySelectorAll('.js-log-line.job-log-line'))
      .find(line => line.offsetHeight > 0)
    return first && first.getBoundingClientRect().top >= 0 && first.getBoundingClientRect().bottom < window.innerHeight
  }, 15)
  if (name === 'test') {
    await I.executeScript(() => {
      // GitLab's 21.5px rows meet an integer scroll offset. An extra build-log
      // line then shifts alternate glyph rows by one pixel. Use whole-pixel
      // line spacing before scrolling; keep the text, colours and font intact.
      const log = document.querySelector('.job-log')
      log.style.lineHeight = `${Math.ceil(parseFloat(window.getComputedStyle(log).lineHeight))}px`
      const verdict = Array.from(document.querySelectorAll('.js-log-line.job-log-line'))
        .find(line => line.textContent.includes('PASS: the Compose web application returns the expected HTTP response'))
      if (!verdict) throw new Error('The HTTP test verdict must be visible in the job log')
      verdict.scrollIntoView({ block: 'center' })
    })
    await I.waitForFunction(() => {
      const verdict = Array.from(document.querySelectorAll('.js-log-line.job-log-line'))
        .find(line => line.textContent.includes('PASS: the Compose web application returns the expected HTTP response'))
      const box = verdict?.getBoundingClientRect()
      return box && box.top >= 0 && box.bottom < window.innerHeight
    }, 15)
  }
  await I.moveCursorTo('h1')
  await addStoryboardFrame(I, await capturePageFrame(I, frame))
  I.resizeWindow(1024, 768)
}

async function captureLintReport (current, frame, linter = 'SPELL_CSPELL') {
  const file = `megalinter-reports/linters_logs/${linter}-${current.status === 'success' ? 'SUCCESS' : 'ERROR'}.log`
  const auth = Object.entries(state.headers).flatMap(([key, value]) => ['-H', `${key}: ${value}`])
  let content
  try {
    content = execFileSync('curl', ['--fail', '--silent', ...auth,
      `${BASE_URL}/api/v4/projects/${state.projectId}/jobs/${current.id}/artifacts/${file}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (_) { throw new Error(`Could not download the ${linter} report for job ${current.id}`) }
  const rejected = linter === 'SPELL_CSPELL' ? `Unknown word (${MISSPELLING})` : 'Insecure URL'
  assert.ok(content.includes(current.status === 'success' ? '[SUCCESS]' : rejected), 'The downloaded artifact must contain the actual lint verdict')
  if (linter === 'REPOSITORY_DEVSKIM' && current.status === 'failed') {
    assert.ok(content.includes(SECURITY_FILE), 'The security report must identify the deliberately insecure project file')
  }
  content = content.replaceAll(state.projectName, 'hybrid-ci-demo')
    .replace(/version [0-9.]+/g, 'version <version>').replace(/megalinter.io\/[0-9.]+\//g, 'megalinter.io/<version>/')
  await renderPreFrame(I, frame, `$ cat ${file}\n${content}`)
}

function assertNativeJob (name) {
  const current = job(name)
  assert.equal(current.runner.id, state.nativeRunner.id, `${name} must use the unprivileged runner`)
  assert.ok(!trace(current).includes('Starting service docker:'), `${name} must not start DinD`)
  const observed = state.runtime.get(current.id)
  assert.ok(observed?.length, `The live container for ${name} must have been observed`)
  for (const container of observed) {
    assert.equal(container.privileged, false)
    assert.equal(container.dockerSocket, false)
  }
}

storyboardStep(Then, 'Commitlint passes on the unprivileged runner', async () => {
  state.nativeRunner = await registerRunner(false)
  state.dockerRunner = await registerRunner(true)
  assert.equal(await runPipeline(), 'failed', 'The deliberate spelling error must fail the pipeline')
  assert.equal(job('code:commitlint').status, 'success', stripAnsiEscapeSequences(trace(job('code:commitlint'))).slice(-6000))
  assertNativeJob('code:commitlint')
  await captureJob('code:commitlint', 'unprivileged-commitlint-check')
})

storyboardStep(Then, 'MegaLinter rejects a spelling mistake and publishes its reports', async () => {
  const mega = job('code:megalinter')
  assertNativeJob(mega.name)
  assert.equal(mega.status, 'failed')
  const log = trace(mega)
  assert.ok(log.includes(`Unknown word (${MISSPELLING})`), `The failure must be the deliberate spelling mistake:\n${stripAnsiEscapeSequences(log).slice(-6000)}`)
  assert.ok(!log.includes(`Unknown word (${PROJECT_WORD})`), 'The project dictionary must still be read')
  assert.ok(log.includes('Project lint setup complete'), 'The project configuration must run its pre-lint hook')
  assert.ok(log.includes('Project lint reports ready'), 'The project post-lint hook must run even on failure')
  assert.ok(mega.artifacts_file?.size > 0, 'Reports must be downloadable even when lint fails')
  await captureLintReport(mega, 'megalinter-rejects-mistake')
})

storyboardStep(Then, 'the security scan also rejects the insecure URL', async () => {
  const mega = job('code:megalinter')
  assert.ok(trace(mega).includes(SECURITY_FILE), 'DevSkim must scan project source files in the native job')
  await captureLintReport(mega, 'security-rejects-http', 'REPOSITORY_DEVSKIM')
})

storyboardStep(Then, 'MegaLinter starts directly in its own image on the unprivileged runner', async () => {
  const current = job('code:megalinter')
  assertNativeJob(current.name)
  const version = JSON.parse(fs.readFileSync(`${state.dir}/.config/megalinter/package.json`, 'utf8')).dependencies['mega-linter-runner']
  const expected = JSON.parse(docker('image', 'inspect', `ghcr.io/oxsecurity/megalinter:v${version}`))[0].Id
  for (const container of state.runtime.get(current.id)) {
    // Runner records an immutable digest, not the tag used in the CI file.
    assert.equal(JSON.parse(docker('image', 'inspect', container.image))[0].Id, expected)
  }
  await captureJob(current.name, 'megalinter-direct-image')
})

storyboardStep(When, 'I correct both mistakes without changing the lint configuration', async () => {
  fs.writeFileSync(`${state.dir}/project/README.md`, `# Web application\n\n${PROJECT_WORD}\n`)
  fs.writeFileSync(`${state.dir}/${SECURITY_FILE}`, `module.exports = '${INSECURE_URL.replace('http:', 'https:')}'\n`)
  const diff = git('diff', '--', 'project/README.md', SECURITY_FILE)
  assert.deepEqual(git('diff', '--name-only').trim().split('\n'), ['project/README.md', SECURITY_FILE])
  await renderPreFrame(I, 'correct-project-spelling', `$ git diff -- project/README.md ${SECURITY_FILE}\n${diff}`)
  git('add', 'project/README.md', SECURITY_FILE)
  git('commit', '--quiet', '-m', 'fix: correct spelling and use HTTPS')
  push()
})

storyboardStep(When, 'I update the project through Copier and keep my own settings', async () => {
  const projectFiles = ['.config/cspell/config.project.json', '.config/megalinter/config.yml',
    '.env.dist', 'project/Taskfile.yml', 'project/quality/megalinter.yml']
  const before = projectFiles.map(file => fs.readFileSync(`${state.dir}/${file}`, 'utf8'))
  updateProject(state.dir, '1.0.1')
  for (const [index, file] of projectFiles.entries()) {
    assert.equal(fs.readFileSync(`${state.dir}/${file}`, 'utf8'), before[index], `Copier must preserve ${file}`)
  }
  assert.ok(fs.readFileSync(`${state.dir}/${UPDATE_MARKER_FILE}`, 'utf8').includes(UPDATE_MARKER))
  const answers = loadYaml(fs.readFileSync(`${state.dir}/.config/devsecops/.copier-answers.yml`, 'utf8'))
  assert.equal(answers._commit, '1.0.1')
  assert.deepEqual(answers.gitlab_docker_runner_tags, [DOCKER_TAG])
  const diff = git('diff', '--', '.config/devsecops/.copier-answers.yml')
    .replaceAll(state.template, '<template>').replace(/index [0-9a-f]+\.\.[0-9a-f]+/g, 'index <sha>..<sha>')
  await renderPreFrame(I, 'copier-preserves-project-settings', `$ git diff -- .config/devsecops/.copier-answers.yml\n${diff}`)
  git('add', '-A')
  git('commit', '--quiet', '-m', 'chore: update the toolbox through Copier')
})

storyboardStep(Then, 'MegaLinter passes on the unprivileged runner', async () => {
  const status = await runPipeline()
  const mega = job('code:megalinter')
  assert.equal(mega.status, 'success', stripAnsiEscapeSequences(trace(mega)).slice(-6000))
  assert.ok(trace(mega).includes('Project lint reports ready'), 'The same project hook must run after the correction')
  assertNativeJob(mega.name)
  assert.ok(mega.artifacts_file?.size > 0, 'Reports must also be downloadable after success')
  assert.equal(status, 'success', `Failed jobs: ${state.jobs.filter(job => job.status === 'failed').map(job => job.name)}`)
  for (const current of state.jobs) {
    const native = FILE_CHECKS.includes(current.name)
    assert.equal(current.runner.id, native ? state.nativeRunner.id : state.dockerRunner.id, current.name)
  }
  await captureJob(mega.name, 'megalinter-passes-directly')
})

storyboardStep(Then, 'the spelling scan accepts the corrected file', async () => {
  await captureLintReport(job('code:megalinter'), 'megalinter-accepts-correction')
})

storyboardStep(Then, 'the security scan accepts the corrected HTTPS URL', async () => {
  await captureLintReport(job('code:megalinter'), 'security-accepts-https', 'REPOSITORY_DEVSKIM')
})

storyboardStep(Then, 'the Docker runner builds and tests the web application', async () => {
  for (const name of ['code:project', 'build', 'deploy', 'test']) {
    assert.equal(job(name).status, 'success')
    assert.equal(job(name).runner.id, state.dockerRunner.id)
    assert.ok(trace(job(name)).includes('Starting service docker:29-dind'), `${name} must start DinD`)
  }
  assert.ok(trace(job('code:project')).includes('PASS: the project task keeps its Docker engine'))
  assert.ok(trace(job('test')).includes('PASS: the Compose web application returns the expected HTTP response'))
  await captureJob('test', 'docker-web-application')
})
