/* global inject Given When Then Before After document */
const assert = require('assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { I, GitLabUserPage } = inject()
const { prepareVersionedTemplate, renderProjectFromTemplate, updateProject, removeRendered, UPDATE_MARKER, UPDATE_MARKER_FILE } = require('../helpers/copierRender')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const {
  getRootHeaders, lintProjectCi, createProjectRunner, deleteRunner, createMergeRequestWhenBranchExists,
  listPipelineJobs, listProjectPipelines, getPipeline, getJobTrace, getJobArtifact, getRepositoryFile, getRunnerCard, getPipelineTestReport, BASE_URL
} = require('../helpers/gitlabApi')
const { gitlabFrame, gitlabUrl, jobLogFrame, settlePage } = require('../helpers/gitlabCard')
const { publishToGitLab } = require('../helpers/gitlabProject')
const { runnersFrame } = require('../helpers/runnersCard')
const { cancelRedundantPipelines, startIsolatedRunnerService, PIPELINE_TIMEOUT_MS, RUNNER_NET } = require('../helpers/pipelineRunner')
const { freshGet, freshPut } = require('../helpers/http')
const { composeService, stripAnsiEscapeSequences } = require('../helpers/docker')

const DOCKER_TAG = 'saas-linux-medium-amd64'
const BRANCH = 'feat/hybrid-runner-proof'
const TAGS_FILE = '.config/gitlab/ci/tags.yml'
const ANSWERS_FILE = '.config/devsecops/.copier-answers.yml'
const DICTIONARY = '.config/cspell/config.project.json'
// Build the deliberately unknown words without teaching the toolbox dictionary
// to accept them. Only the generated project's dictionary accepts PROJECT_WORD.
const PROJECT_WORD = ['hybrid', 'ci', 'word'].join('')
const MISSPELLING = 'spelling'.replace('ll', 'lll')
const SECURITY_FILE = 'project/code/transport.js'
const INSECURE_URL = ['http:', '', 'example.org/health'].join('/')
const FILE_CHECKS = ['code:commitlint', 'code:commitizen-check', 'code:commitizen-bump-dry',
  'code:lizard', 'code:renovate-validate', 'code:betterleaks', 'code:megalinter', 'code:all', 'no-cheat']
const PROJECT_JOBS = ['code:project', 'plan', 'build', 'test', 'release', 'deploy', 'operate', 'monitor', 'feedback']
const OWNER_LABEL = 'io.digital-commons.e2e.run'
// The JUnit report the fixture's health check writes, and its one case.
const JUNIT_REPORT = 'project/tests/_output/junit/health.xml'
const HEALTH_CASE = 'the Compose web application returns the expected HTTP response'
// The web application's plumbing above the README diff on the Changes tab.
const PLUMBING = ['project/code/check-runtime.sh', 'project/tests/health.sh', 'project/web/Dockerfile', 'project/web/index.html']
// The runner's own sections, folded the way a reader skips them.
const RUNNER_SECTIONS = ['Preparing the "docker" executor', 'Preparing environment', 'Getting source from Git repository',
  'Restoring cache', 'Saving cache', 'Uploading artifacts', 'Cleaning up project directory']
// The two MegaLinter sections the story is about, open; every other linter
// stays folded on its one-line verdict, as GitLab shows it.
const LINT_SECTIONS = ['files with [devskim]', 'files with [cspell]']
// What changes from one MegaLinter run to the next without changing its
// verdict: timings, file counts that move with every template file, and the
// linter versions that move with every MegaLinter release (the image card
// shows that version once).
const MEGALINTER_MASKS = [
  [/\(\d+(?:\.\d+)?s\)/g, '(<duration>)'],
  [/(Number of files analyzed: \[)\d+/g, '$1<count>'],
  [/(Files checked: )\d+/g, '$1<count>'],
  [/(megalinter\.io\/)\d+\.\d+\.\d+/g, '$1<version>'],
  [/( v)\d+\.\d+\.\d+(\])/g, '$1<version>$2']
]
let state

// Reuse Copier's already pinned Python environment; no extra test dependency.
function loadYaml (input) {
  return JSON.parse(execFileSync('uvx', ['--python', '3.14', '--from', 'copier==9.14.3',
    'python', '-c', 'import json, sys, yaml; print(json.dumps(yaml.safe_load(sys.stdin.read())))'],
  { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }))
}

Before(() => { state = { runners: [], runtime: new Map(), traces: new Map() } })
// CodeceptJS fires a Gherkin After without awaiting it: the next scenario's
// Before replaces `state` while this one still awaits GitLab, so it keeps its own.
After(async () => {
  const s = state
  if (!s.dir && !s.template) return
  try {
    if (s.pub) {
      const root = await getRootHeaders()
      await cancelRedundantPipelines(s.pub.projectName, 0, root)
      for (const runner of s.runners) {
        try { docker('exec', runner.service, 'gitlab-runner', 'unregister', '--url', 'http://gitlab', '--token', runner.token) } catch (_) {} // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
        await deleteRunner(runner.id, root)
      }
    }
  } finally {
    // The unprivileged runner service and any job container it left behind.
    if (s.owner) {
      const owned = docker('ps', '--all', '--quiet', '--filter', `label=${OWNER_LABEL}=${s.owner}`).trim()
      if (owned) docker('rm', '--force', '--volumes', ...owned.split('\n'))
    }
    if (s.pub) await s.pub.teardown()
    removeRendered(s.dir)
    removeRendered(s.template)
  }
})

function git (...args) {
  return execFileSync('git', ['-C', state.dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function docker (...args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 })
}

// The branch goes up WITHOUT ci.skip: on an open merge request, this push is
// what starts the next merge request pipeline.
function push () {
  const remote = new URL(`http://gitlab/${process.env.TASK_GITLAB_LAMBDA_USER}/${state.projectName}.git`) // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
  remote.username = process.env.TASK_GITLAB_LAMBDA_USER
  remote.password = state.pub.token
  try {
    git('push', '--quiet', remote.href, `HEAD:refs/heads/${BRANCH}`)
  } catch (_) {
    throw new Error('Could not push the hybrid runner proof branch')
  }
}

async function waitForPushedBranch () {
  const expected = git('rev-parse', 'HEAD').trim()
  const deadline = Date.now() + 60000
  let observed = 'missing'
  while (Date.now() < deadline) {
    const response = await freshGet(
      `${BASE_URL}/api/v4/projects/${state.projectId}/repository/branches/${encodeURIComponent(BRANCH)}`,
      state.headers
    )
    assert.ok(response.status === 200 || response.status === 404,
      `Reading the pushed branch returned ${response.status}`)
    observed = response.data?.commit?.id || 'missing'
    if (observed === expected) return
    await I.wait(2)
  }
  throw new Error(`GitLab never exposed ${BRANCH} at ${expected}; got ${observed}`)
}

async function mergeRequestPipelines () {
  const response = await freshGet(`${BASE_URL}/api/v4/projects/${state.projectId}/merge_requests/${state.mr}/pipelines`, state.headers)
  assert.equal(response.status, 200)
  return response.data
}

// The file checks get a runner service of their own: they start no
// container, so they run beside the Docker jobs instead of queuing behind
// them in the shared service, whose single slot keeps the Docker-in-Docker
// jobs apart.
function startNativeRunnerService () {
  state.owner = crypto.randomBytes(8).toString('hex')
  state.nativeService = startIsolatedRunnerService(`e2e-hybrid-${state.owner}-runner`, state.owner)
}

async function registerRunner (privileged) {
  const headers = await getRootHeaders()
  const created = await createProjectRunner(state.projectId, headers, privileged ? [DOCKER_TAG] : [])
  assert.ok(created.status < 400, `Runner creation returned ${created.status}`)
  const service = privileged ? composeService('gitlab-runner') : state.nativeService
  const runner = { id: created.data.id, token: created.data.token, service, privileged }
  state.runners.push(runner)
  const configured = await freshPut(`${BASE_URL}/api/v4/runners/${runner.id}`, {
    run_untagged: !privileged, description: privileged ? 'Docker jobs' : 'Unprivileged file checks'
  }, headers)
  assert.equal(configured.status, 200)
  const args = ['exec', runner.service, 'gitlab-runner', 'register', '--non-interactive',
    '--url', 'http://gitlab', '--token', runner.token, '--executor', 'docker', // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
    '--docker-image', 'alpine:3.20', '--docker-network-mode', RUNNER_NET,
    `--docker-privileged=${privileged}`]
  if (privileged) args.push('--docker-volumes', '/certs/client')
  try { docker(...args) } catch (_) { throw new Error(`Registration failed for project runner ${runner.id}`) }
  docker('kill', '-s', 'HUP', runner.service)
  return runner
}

async function trace (job) {
  if (!state.traces.has(job.id)) state.traces.set(job.id, await getJobTrace(state.projectName, job.id, state.headers))
  return state.traces.get(job.id)
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

// Wait for the merge request pipeline of the pushed HEAD to finish.
async function runPipeline () {
  const sha = git('rev-parse', 'HEAD').trim()
  const deadline = Date.now() + PIPELINE_TIMEOUT_MS
  let id
  let previous = ''
  while (Date.now() < deadline) {
    if (!id) id = (await mergeRequestPipelines()).find(pipeline => pipeline.sha === sha)?.id
    if (id) {
      const pipeline = await getPipeline(state.projectName, id, state.headers)
      const jobs = (await listPipelineJobs(state.projectName, id, state.headers)).data
      const progress = jobs.map(job => `${job.name}=${job.status}`).join(', ')
      if (progress !== previous) { console.log(`Hybrid pipeline ${id}: ${progress}`); previous = progress }
      observeRuntime(jobs)
      if (['success', 'failed', 'canceled'].includes(pipeline.data.status)) {
        state.pipelineId = id
        state.jobs = jobs
        await savePipelineEvidence(id, jobs)
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

// Kept under _output: After deletes the project, and its job logs with it.
async function savePipelineEvidence (id, jobs) {
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
  for (const current of jobs) fs.writeFileSync(path.join(directory, `${current.id}.log`), await trace(current))
}

async function assertNativeJob (name) {
  const current = job(name)
  assert.equal(current.runner.id, state.nativeRunner.id, `${name} must use the unprivileged runner`)
  assert.ok(!(await trace(current)).includes('Starting service docker:'), `${name} must not start DinD`)
  const observed = state.runtime.get(current.id)
  assert.ok(observed?.length, `The live container for ${name} must have been observed`)
  for (const container of observed) {
    assert.equal(container.privileged, false)
    assert.equal(container.dockerSocket, false)
  }
}

// MegaLinter ran in the very image the generated pipeline names: the runner
// records an immutable digest, not the tag used in the CI file.
function assertMegalinterImage (current) {
  const version = JSON.parse(fs.readFileSync(`${state.dir}/.config/megalinter/package.json`, 'utf8')).dependencies['mega-linter-runner']
  const expected = JSON.parse(docker('image', 'inspect', `ghcr.io/oxsecurity/megalinter:v${version}`))[0].Id
  for (const container of state.runtime.get(current.id)) {
    assert.equal(JSON.parse(docker('image', 'inspect', container.image))[0].Id, expected)
  }
}

async function lintReport (current, linter) {
  const verdict = current.status === 'success' ? 'SUCCESS' : 'ERROR'
  return getJobArtifact(state.projectName, current.id, `megalinter-reports/linters_logs/${linter}-${verdict}.log`, state.headers)
}

// The job page of code:megalinter with its devskim and cspell sections open.
// The focus line sits the same distance below the devskim header in both
// runs, so the refused and the accepted card are shot from the same place.
async function lintSectionsFrame (frame, current, focus) {
  await jobLogFrame(I, frame, state.projectName, current.id, {
    waitText: current.status === 'success' ? 'Job succeeded' : 'Job failed',
    height: 1100,
    unfold: LINT_SECTIONS,
    masks: MEGALINTER_MASKS,
    focus
  })
}

storyboardStep(Given, 'I generate a self-hosted project using the saas-linux-medium-amd64 Docker runner tag and push it to GitLab', async () => {
  state.template = prepareVersionedTemplate()
  state.dir = renderProjectFromTemplate(state.template, '1.0.0', {
    ci_platform: 'gitlab_self_hosted',
    gitlab_docker_runner_tags: JSON.stringify([DOCKER_TAG]),
    gitlab_docker_host: 'tcp://docker:2376',
    gitlab_docker_tls_certdir: '/certs',
    devsecops_automerge: false
  })
  // Fixture commits: the hooks a rendered project installs are another story's subject.
  git('config', 'core.hooksPath', '/dev/null')
  const tags = fs.readFileSync(`${state.dir}/${TAGS_FILE}`, 'utf8')
  assert.deepEqual(loadYaml(tags)['.default-tags'].tags, [DOCKER_TAG],
    'Copier must preserve the selected Docker runner tags in self-hosted mode')
  try {
    execFileSync('task', ['yamllint', 'TASK_YAMLLINT_PATH_TO_LINT=.config/devsecops/.copier-answers.yml .config/gitlab/ci/services.yml .config/gitlab/ci/variables.yml'],
      { cwd: state.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    throw new Error(`Generated runner settings must pass the YAML rules:\n${stripAnsiEscapeSequences(String(error.stdout || '') + String(error.stderr || ''))}`)
  }
  // ci.skip: no pipeline waits on the main branch for runners that come later.
  state.pub = await publishToGitLab(state.dir, {
    name: `e2e-hybrid-ci-${crypto.randomBytes(4).toString('hex')}`,
    project: { shared_runners_enabled: false, group_runners_enabled: false },
    pushOptions: ['ci.skip']
  })
  state.projectName = state.pub.projectName
  state.projectId = state.pub.projectId
  state.headers = state.pub.headers
  assert.equal(await getRepositoryFile(state.projectName, TAGS_FILE, 'main', state.headers), tags)

  // GitLab resolves the whole generated pipeline: file checks carry no tag and
  // no service, project tasks keep their Docker runner and Docker-in-Docker.
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

  // GitLab records the ci.skip push as a skipped pipeline on a background job.
  // The card waits for it, on the API then on the page, so the last commit
  // always carries its grey status icon.
  const sha = git('rev-parse', 'HEAD').trim()
  let pipelines = []
  for (const deadline = Date.now() + 60000; !pipelines.length && Date.now() < deadline;) {
    pipelines = (await listProjectPipelines(state.projectName, state.headers, `?sha=${sha}`)).data || []
    if (!pipelines.length) await I.wait(2)
  }
  assert.deepEqual(pipelines.map(pipeline => pipeline.status), ['skipped'], 'The ci.skip push must record one skipped pipeline')

  await GitLabUserPage.loginAs(process.env.TASK_GITLAB_LAMBDA_USER, process.env.TASK_GITLAB_LAMBDA_PASSWORD)
  await gitlabFrame(I, 'docker-runner-selection', gitlabUrl.file(state.projectName, 'main', TAGS_FILE), {
    waitText: DOCKER_TAG,
    height: 620,
    prepare: () => I.waitForElement('[data-testid="ci-icon"]', 30)
  })
})

storyboardStep(When, 'I open a merge request that adds the web application, its own lint settings and two deliberate mistakes', async () => {
  const pipeline = fs.readFileSync(`${state.dir}/.gitlab-ci.yml`, 'utf8')
  assert.ok(!pipeline.includes('project/gitlab-ci.yml'), 'The generated pipeline must not include a project CI extension')
  // Issue #162: the toolbox ships the project's own dictionary file, so the
  // project has a place for its words that a toolbox update leaves alone.
  assert.ok(fs.existsSync(`${state.dir}/${DICTIONARY}`), `A fresh render must ship ${DICTIONARY} for the project's own words`)
  fs.cpSync(path.join(__dirname, '../../fixtures/hybrid-ci/project'), `${state.dir}/project`, { recursive: true })
  assert.equal(fs.readFileSync(`${state.dir}/.gitlab-ci.yml`, 'utf8'), pipeline)
  assert.ok(!fs.existsSync(`${state.dir}/project/gitlab-ci.yml`), 'The project must use the generated pipeline directly')
  fs.appendFileSync(`${state.dir}/.env.dist`, '\nTASK_MEGALINTER_CONFIG=project/quality/megalinter.yml\n')
  fs.writeFileSync(`${state.dir}/project/README.md`, `# Web application\n\n${PROJECT_WORD} ${MISSPELLING}\n`)
  fs.writeFileSync(`${state.dir}/${SECURITY_FILE}`, `module.exports = '${INSECURE_URL}'\n`)
  fs.writeFileSync(`${state.dir}/${DICTIONARY}`, JSON.stringify({ version: '0.2', words: [PROJECT_WORD] }, null, 2) + '\n')
  git('switch', '--quiet', '-c', BRANCH)
  git('add', '-A')
  git('commit', '--quiet', '-m', 'feat: demonstrate separate runners for checks and containers')
  const changed = git('diff', '--name-only', 'main', 'HEAD').trim().split('\n').sort()
  push()
  const mr = await createMergeRequestWhenBranchExists(state.projectName, {
    source_branch: BRANCH,
    target_branch: 'main',
    title: 'Run file checks and the web application on separate runners'
  }, state.headers)
  assert.ok(mr.status < 400, `Merge request creation returned ${mr.status}: ${JSON.stringify(mr.data?.message || mr.data?.error)}`)
  state.mr = mr.data.iid
  state.reviewedSha = git('rev-parse', 'HEAD').trim()
  const lint = await lintProjectCi(state.projectName, state.headers, BRANCH)
  assert.equal(lint.data.valid, true, JSON.stringify(lint.data.errors))
  const code = loadYaml(lint.data.merged_yaml)['code:project']
  assert.deepEqual(code.tags, [DOCKER_TAG], 'Project tasks must retain the selected Docker runner')
  assert.ok(code.services.some(service => service.name === 'docker:29-dind'), 'Project tasks must retain DinD')
  assert.equal(code.variables.DOCKER_HOST, 'tcp://docker:2376')
  // Twin of the Changes tab: GitLab lists exactly the files of the commit,
  // and the generated pipeline is not among them.
  let diffs
  const deadline = Date.now() + 60000
  do {
    diffs = await freshGet(`${BASE_URL}/api/v4/projects/${state.projectId}/merge_requests/${state.mr}/diffs?per_page=100`, state.headers)
    if (diffs.status === 200 && diffs.data.length === changed.length) break
    await I.wait(2)
  } while (Date.now() < deadline)
  assert.deepEqual(diffs.data.map(diff => diff.new_path).sort(), changed)
  assert.ok(!changed.includes('.gitlab-ci.yml'), 'The merge request must leave the generated pipeline alone')
  // Twin of the open diffs: the project's word, its lint settings and the two mistakes.
  for (const [file, line] of [[DICTIONARY, `"${PROJECT_WORD}"`], ['project/quality/megalinter.yml', 'EXTENDS: .config/megalinter/config.yml'],
    [SECURITY_FILE, INSECURE_URL], ['project/README.md', `${PROJECT_WORD} ${MISSPELLING}`],
    ['.env.dist', 'TASK_MEGALINTER_CONFIG=project/quality/megalinter.yml']]) {
    assert.ok(diffs.data.find(diff => diff.new_path === file).diff.includes(line), `The ${file} diff must add ${line}`)
  }
  // The merge request pipeline exists, and waits for the runners of the next step.
  const until = Date.now() + 60000
  while (!(await mergeRequestPipelines()).length && Date.now() < until) await I.wait(2)
  assert.equal((await mergeRequestPipelines()).length, 1, 'Opening the merge request must start its pipeline')
  await gitlabFrame(I, 'merge-request-changes', gitlabUrl.mr(state.projectName, state.mr, 'diffs'), {
    waitText: 'config.project.json',
    height: 1100,
    // The web application's plumbing, folded with GitLab's own chevron: its
    // headers stay in the list, and the diffs the sentence names fit the card.
    prepare: async () => {
      // waitForFunction hands its argument array over as ONE argument.
      await I.waitForFunction(([count]) => document.querySelectorAll('diff-file').length === count, [changed.length], 60)
      await I.executeScript((paths) => {
        for (const file of document.querySelectorAll('diff-file')) {
          if (paths.includes(file.querySelector('.rd-diff-file-title')?.textContent.trim())) {
            file.querySelector('button.rd-diff-file-toggle-button[data-opened]').click()
          }
        }
      }, PLUMBING)
      await I.waitForFunction(([paths]) => document.querySelectorAll('diff-file article[data-collapsed="true"]').length === paths.length,
        [PLUMBING], 30)
    },
    // Down to the README diff, the second mistake: GitLab swaps the title for
    // its sticky merge request header, as it does for any reader who scrolls.
    scrollTo: async () => {
      await I.executeScript(() => {
        document.querySelectorAll('.js-static-panel-inner').forEach(el => { el.scrollTop = 0 })
        const readme = Array.from(document.querySelectorAll('diff-file'))
          .find(file => file.querySelector('.rd-diff-file-title')?.textContent.trim() === 'project/README.md')
        if (!readme) throw new Error('The Changes tab shows no project/README.md diff')
        readme.querySelector('article').scrollIntoView({ block: 'end' })
      })
      await settlePage(I, { quietMs: 300 })
    }
  })
})

storyboardStep(When, 'the project gets an unprivileged runner for file checks and a Docker runner for containers', async () => {
  startNativeRunnerService()
  state.nativeRunner = await registerRunner(false)
  state.dockerRunner = await registerRunner(true)
  assert.equal(await runPipeline(), 'failed', 'The deliberate spelling error must fail the pipeline')
  const commitlint = job('code:commitlint')
  assert.equal(commitlint.status, 'success', stripAnsiEscapeSequences(await trace(commitlint)).slice(-6000))
  // The generated jobs still go through Task.
  assert.ok((await trace(commitlint)).includes('$ task commitlint'))
  assert.ok((await trace(job('code:megalinter'))).includes('$ task megalinter:ci'))
  await assertNativeJob('code:commitlint')
  // Only MegaLinter fails, code:all waits for it and never starts, and each
  // runner took exactly its own half of the jobs that ran.
  const expected = { 'code:megalinter': 'failed', 'code:all': 'skipped' }
  for (const current of state.jobs) {
    const native = FILE_CHECKS.includes(current.name)
    assert.equal(current.status, expected[current.name] || 'success', current.name)
    if (current.status === 'skipped') continue
    assert.equal(current.runner.id, native ? state.nativeRunner.id : state.dockerRunner.id, current.name)
  }
  assert.equal(state.jobs.length, FILE_CHECKS.length + PROJECT_JOBS.length)
  // Twin of the runners card: one untagged runner, one tagged Docker runner.
  for (const [runner, description, tags, untagged, jobCount] of [
    [state.nativeRunner, 'Unprivileged file checks', [], true, FILE_CHECKS.length - 1],
    [state.dockerRunner, 'Docker jobs', [DOCKER_TAG], false, PROJECT_JOBS.length]
  ]) {
    const response = await freshGet(`${BASE_URL}/api/v4/runners/${runner.id}`, await getRootHeaders())
    assert.equal(response.data.description, description)
    assert.deepEqual(response.data.tag_list, tags)
    assert.equal(response.data.run_untagged, untagged)
    // As the card shows it: online, with its half of the jobs that ran.
    assert.deepEqual(await getRunnerCard(runner.id, await getRootHeaders()), { status: 'ONLINE', jobCount })
  }
  await runnersFrame(I, 'project-runners', state.projectName, { waitText: 'Unprivileged file checks', height: 540 })
})

storyboardStep(Then, 'MegaLinter starts directly in its own image on the unprivileged runner', async () => {
  const current = job('code:megalinter')
  await assertNativeJob(current.name)
  assertMegalinterImage(current)
  await jobLogFrame(I, 'megalinter-direct-image', state.projectName, current.id, {
    waitText: 'Job failed',
    height: 1000,
    unfold: ['Preparing the "docker" executor'],
    fold: [...RUNNER_SECTIONS.slice(1), 'Executing "step_script"']
  })
})

storyboardStep(Then, 'MegaLinter rejects the misspelled word and the insecure URL and keeps its reports', async () => {
  const mega = job('code:megalinter')
  assert.equal(mega.status, 'failed')
  const log = await trace(mega)
  assert.ok(log.includes(`Unknown word (${MISSPELLING})`), `The failure must be the deliberate spelling mistake:\n${stripAnsiEscapeSequences(log).slice(-6000)}`)
  assert.ok(!log.includes(`Unknown word (${PROJECT_WORD})`), 'The project dictionary must still be read')
  assert.ok(log.includes(SECURITY_FILE), 'DevSkim must scan project source files in the native job')
  assert.ok(log.includes('Project lint setup complete'), 'The project configuration must run its pre-lint hook')
  assert.ok(log.includes('Project lint reports ready'), 'The project post-lint hook must run even on failure')
  assert.ok(mega.artifacts_file?.size > 0, 'Reports must be downloadable even when lint fails')
  assert.ok((await lintReport(mega, 'SPELL_CSPELL')).includes(`Unknown word (${MISSPELLING})`), 'The spelling report must name the misspelled word')
  const security = await lintReport(mega, 'REPOSITORY_DEVSKIM')
  assert.ok(security.includes('Insecure URL') && security.includes(SECURITY_FILE), 'The security report must point at the insecure URL')
  await lintSectionsFrame('megalinter-rejects-mistake', mega, 'warning: 1 warnings emitted')
})

storyboardStep(Then, 'code:all does not claim the checks passed while MegaLinter is red', async () => {
  assert.equal(job('code:megalinter').status, 'failed')
  const current = job('code:all')
  assert.equal(current.status, 'skipped', 'code:all must not run while a check it waits for has failed')
  assert.ok(!(await trace(current)).includes('All code checks passed.'), 'A skipped code:all must print no verdict')
  // A skipped job never ran: its page has no log to frame, only its status.
  await gitlabFrame(I, 'code-all-skipped-while-megalinter-fails', gitlabUrl.job(state.projectName, current.id), {
    waitText: 'This job has been skipped', height: 1000
  })
})

storyboardStep(When, 'I update the project through Copier and correct both mistakes in the same merge request', async () => {
  const projectFiles = [DICTIONARY, '.config/megalinter/config.yml', '.env.dist', 'project/Taskfile.yml',
    'project/quality/megalinter.yml', TAGS_FILE]
  const before = projectFiles.map(file => fs.readFileSync(`${state.dir}/${file}`, 'utf8'))
  updateProject(state.dir, '1.0.1')
  for (const [index, file] of projectFiles.entries()) {
    assert.equal(fs.readFileSync(`${state.dir}/${file}`, 'utf8'), before[index], `Copier must preserve ${file}`)
  }
  assert.ok(fs.readFileSync(`${state.dir}/${UPDATE_MARKER_FILE}`, 'utf8').includes(UPDATE_MARKER))
  const answers = loadYaml(fs.readFileSync(`${state.dir}/${ANSWERS_FILE}`, 'utf8'))
  assert.equal(answers._commit, '1.0.1')
  assert.deepEqual(answers.gitlab_docker_runner_tags, [DOCKER_TAG])
  git('add', '-A')
  git('commit', '--quiet', '-m', 'chore: update the toolbox through Copier')
  fs.writeFileSync(`${state.dir}/project/README.md`, `# Web application\n\n${PROJECT_WORD}\n`)
  fs.writeFileSync(`${state.dir}/${SECURITY_FILE}`, `module.exports = '${INSECURE_URL.replace('http:', 'https:')}'\n`)
  assert.deepEqual(git('diff', '--name-only').trim().split('\n'), ['project/README.md', SECURITY_FILE])
  git('add', 'project/README.md', SECURITY_FILE)
  git('commit', '--quiet', '-m', 'fix: correct spelling and use HTTPS')
  push()
  await waitForPushedBranch()
  const head = git('rev-parse', 'HEAD').trim()
  // Twin of the compare card: the two commits change these four files, and
  // none of the project's own settings.
  const compare = await freshGet(`${BASE_URL}/api/v4/projects/${state.projectId}/repository/compare?from=${state.reviewedSha}&to=${head}`, state.headers)
  assert.equal(compare.status, 200)
  assert.deepEqual(compare.data.commits.map(commit => commit.title).sort(),
    ['chore: update the toolbox through Copier', 'fix: correct spelling and use HTTPS'])
  assert.deepEqual(compare.data.diffs.map(diff => diff.new_path).sort(),
    [ANSWERS_FILE, UPDATE_MARKER_FILE, 'project/README.md', SECURITY_FILE].sort())
  await gitlabFrame(I, 'copier-preserves-project-settings', gitlabUrl.compare(state.projectName, state.reviewedSha, head), {
    waitText: 'chore: update the toolbox through Copier',
    height: 880,
    // The breadcrumb names both revisions by their full SHA.
    hide: ['[data-testid="breadcrumb-links"] li:last-child', 'nav[aria-label="Breadcrumb"] li:last-child'],
    textMasks: [[/\/tmp\/e2e-template-[0-9a-f]+/g, '<template>'], [/\b[0-9a-f]{40}\b/g, '']],
    // From the two commits down: the revision pickers above them only
    // repeat the masked SHAs.
    scrollTo: async () => {
      await I.executeScript(() => {
        const title = Array.from(document.querySelectorAll('h2, h3, h4, h5, span, div, strong')).find(el =>
          Array.from(el.childNodes).some(n => n.nodeType === 3 && n.nodeValue.trim() === 'Commits on Source'))
        if (!title) throw new Error('The compare page shows no "Commits on Source" box')
        ;(title.closest('.gl-card, .card') || title).scrollIntoView({ block: 'start' })
      })
      await settlePage(I, { quietMs: 300 })
    }
  })
})

storyboardStep(Then, 'MegaLinter passes on the unprivileged runner and accepts both corrections', async () => {
  const status = await runPipeline()
  const mega = job('code:megalinter')
  assert.equal(mega.status, 'success', stripAnsiEscapeSequences(await trace(mega)).slice(-6000))
  assert.ok((await trace(mega)).includes('Project lint reports ready'), 'The same project hook must run after the correction')
  await assertNativeJob(mega.name)
  assertMegalinterImage(mega)
  assert.ok(mega.artifacts_file?.size > 0, 'Reports must also be downloadable after success')
  for (const linter of ['SPELL_CSPELL', 'REPOSITORY_DEVSKIM']) {
    assert.ok((await lintReport(mega, linter)).includes('[SUCCESS]'), `The ${linter} report must accept the corrected files`)
  }
  assert.equal(status, 'success', `Failed jobs: ${state.jobs.filter(job => job.status === 'failed').map(job => job.name)}`)
  for (const current of state.jobs) {
    const native = FILE_CHECKS.includes(current.name)
    assert.equal(current.runner.id, native ? state.nativeRunner.id : state.dockerRunner.id, current.name)
  }
  await lintSectionsFrame('megalinter-passes-directly', mega, 'files with [trivy]')
})

storyboardStep(Then, 'code:all now reports that every code check passed', async () => {
  const current = job('code:all')
  assert.equal(current.status, 'success')
  assert.ok((await trace(current)).includes('All code checks passed.'), 'The code:all log must carry its verdict')
  // Folded too: the artifacts it downloads from code:megalinter carry that
  // job's per-run id.
  await jobLogFrame(I, 'code-all-passes-once-every-check-passed', state.projectName, current.id, {
    waitText: 'Job succeeded', height: 1000, fold: [...RUNNER_SECTIONS, 'Downloading artifacts']
  })
})

storyboardStep(Then, 'the Docker runner builds and tests the web application', async () => {
  for (const name of ['code:project', 'build', 'deploy', 'test']) {
    assert.equal(job(name).status, 'success')
    assert.equal(job(name).runner.id, state.dockerRunner.id)
    assert.ok((await trace(job(name))).includes('Starting service docker:29-dind'), `${name} must start DinD`)
  }
  assert.ok((await trace(job('code:project'))).includes('PASS: the project task keeps its Docker engine'))
  const verdict = 'PASS: the Compose web application returns the expected HTTP response'
  assert.ok((await trace(job('test'))).includes('$ task test'))
  assert.ok((await trace(job('test'))).includes(verdict))
  await jobLogFrame(I, 'docker-web-application', state.projectName, job('test').id, {
    waitText: 'Job succeeded',
    height: 1000,
    fold: RUNNER_SECTIONS,
    // BuildKit's progress lines change from one run to the next (a step's
    // time, a second 'writing image' line): the log starts where Compose says
    // the image is built.
    from: 'Image project-web Built',
    masks: [[/\b\d+(?:\.\d+)?s\b/g, '<duration>']],
    focus: verdict
  })
})

storyboardStep(Then, 'GitLab lists the web application\'s test on the pipeline\'s Tests tab', async () => {
  // Issue #248: the job archives the report whether GitLab reads it or not.
  const archived = await getJobArtifact(state.projectName, job('test').id, JUNIT_REPORT, state.headers)
  assert.ok(String(archived).includes(HEALTH_CASE), `The test job must archive ${JUNIT_REPORT}`)
  // Twin of the Tests tab: GitLab's own reading of that report, through its API.
  let report
  for (let i = 0; i < 30 && !report?.total_count; i++) {
    if (i) await I.wait(2)
    report = await getPipelineTestReport(state.projectName, state.pipelineId, state.headers)
  }
  assert.equal(report.total_count, 1, `GitLab must read the test job's JUnit report: ${JSON.stringify(report)}`)
  assert.equal(report.success_count, 1, JSON.stringify(report))
  assert.deepEqual(report.test_suites.map(suite => suite.name), ['test'])
  assert.deepEqual(report.test_suites[0].test_cases.map(testCase => testCase.name), [HEALTH_CASE])
  await gitlabFrame(I, 'gitlab-test-results', `${gitlabUrl.pipeline(state.projectName, state.pipelineId)}/test_report`, {
    waitText: 'success rate',
    height: 600,
    textMasks: [[/\b\d+(\.\d+)?\s?(ms|s)\b/g, '']],
    // The summary lists one suite per job: open the test job's, to list its case.
    prepare: async () => {
      await I.click('.js-suite-row')
      await I.waitForElement('[data-testid="test-case-row"]', 30)
    }
  })
})
