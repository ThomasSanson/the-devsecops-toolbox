/* global inject Given Then Before After */
/**
 * Generated-CI storyboard — proves the .gitlab-ci.yml a vanilla project ships is
 * valid and (second scenario) that a real runner executes its pipeline.
 *
 * The suite stopped at "MR opened + config posted": nothing proved the
 * generated CI plan is even valid, let alone that it runs. Here we render a
 * vanilla project, create a project on the embedded GitLab, push the tree, and
 * ask GitLab itself: (1) is this config valid (GET /ci/lint, the fast
 * deterministic guardrail), and (2) does a scoped runner actually turn one of
 * its jobs green. ONE Gherkin sentence = ONE card = ONE pixel baseline
 * (tolerance: 0); every card twins its frame with a real REST fact.
 */
const { I } = inject()
const crypto = require('crypto')
const fs = require('fs')
const { execSync } = require('child_process')
const { renderProject, removeRendered } = require('../helpers/copierRender')
const { renderPreFrame } = require('../helpers/capturedOutput')
const { runCommandWithResult } = require('../helpers/docker')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const {
  getRootHeaders,
  createProject,
  deleteProject,
  createLambdaPersonalAccessToken,
  revokePersonalAccessToken,
  lintProjectCi,
  createProjectRunner,
  deleteRunner,
  triggerProjectPipeline,
  listProjectPipelines,
  listPipelineJobs
} = require('../helpers/gitlabApi')

const CI_FILE = '.gitlab-ci.yml'
// The toolbox base-image version moves on every framework release; mask it so
// the card stays pixel-stable while still proving the image points at the
// toolbox and the pipeline is wired in from local includes.
const IMAGE_VERSION = /(the-devsecops-toolbox):[^\s]+/

// The docker network the whole compose stack shares (project name + network
// name); the runner and its job containers must join it to resolve http://gitlab.
const NET = 'the-devsecops-toolbox_the-devsecops-toolbox'
// renovate: datasource=docker depName=gitlab/gitlab-runner
const RUNNER_IMAGE = 'gitlab/gitlab-runner:v18.11.0'
// Generated jobs carry this tag (.config/gitlab/ci/tags.yml `.default-tags`), so
// the runner must advertise it or every job sits pending.
const RUNNER_TAG = 'saas-linux-medium-amd64'
// The job we prove goes green. `plan` is the pipeline's first stage, so a runner
// picks it up first even at concurrency 1; it runs `task plan` (plain echoes on a
// vanilla project) so it is deterministic and cheap once the toolbox base image
// is pulled. The `code:*` gates only run on merge requests, not on a push to the
// default branch, so they are not available here.
const TARGET_JOB = 'plan'
const TARGET_STAGE = 'plan'
// The job runs in ~40 s locally (toolbox image pull + `task plan` echoes); the
// runner is slower inside dind in CI, so allow generous headroom (retries: 1
// absorbs a one-off slow pull).
const JOB_TIMEOUT_MS = 360000

let project
let projectName
let lambdaToken
let lambdaTokenId
let projectId
let runnerName
let runnerId

function git (dir, cmd) {
  return execSync(`git -C ${dir} ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

// Create a public project owned by the lambda user and push the rendered tree to
// its main branch, so GitLab can resolve the `local:` includes and, later, run
// the pipeline. Returns nothing; throws on push failure without leaking the PAT.
async function createAndPushProject (dir) {
  const rootHeaders = await getRootHeaders()
  projectName = `e2e-generated-ci-${crypto.randomBytes(4).toString('hex')}`
  const created = await createLambdaPersonalAccessToken(
    `generated-ci-${projectName}`, ['api', 'write_repository'], rootHeaders
  )
  lambdaToken = created.token
  lambdaTokenId = created.id
  const created2 = await createProject(
    { name: projectName, visibility: 'public', initialize_with_readme: false },
    { 'PRIVATE-TOKEN': lambdaToken }
  )
  if (created2.status >= 400) {
    throw new Error(`createProject failed (${created2.status}): ${JSON.stringify(created2.data)}`)
  }
  projectId = created2.data.id
  const user = process.env.TASK_GITLAB_LAMBDA_USER
  const remote = `http://${user}:${encodeURIComponent(lambdaToken)}@gitlab/${user}/${projectName}.git`
  git(dir, 'init --quiet --initial-branch=main')
  git(dir, 'config user.email "e2e@test.local"')
  git(dir, 'config user.name "E2E"')
  git(dir, 'config core.hooksPath /dev/null')
  git(dir, 'add -A')
  git(dir, 'commit --quiet -m "chore: initial render"')
  try {
    execSync(`git -C ${dir} push --quiet ${remote} HEAD:refs/heads/main`, { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    // Never surface the remote (it carries the PAT) in the failure message.
    throw new Error(`git push to project ${projectName} failed`)
  }
}

function resetState () {
  project = null
  projectName = null
  lambdaToken = null
  lambdaTokenId = null
  projectId = null
  runnerName = null
  runnerId = null
}

Before(resetState)

After(async () => {
  if (project) removeRendered(project)
  // The scoped runner dies with the story: rm the container and delete the
  // runner so nothing lingers on the shared docker daemon or the GitLab volume.
  if (runnerName) { try { runCommandWithResult(`docker rm -f ${runnerName}`) } catch (e) {} }
  if (projectName || lambdaTokenId || runnerId) {
    const rootHeaders = await getRootHeaders()
    if (runnerId) { try { await deleteRunner(runnerId, rootHeaders) } catch (e) {} }
    if (projectName) { try { await deleteProject(projectName, rootHeaders) } catch (e) {} }
    if (lambdaTokenId) { try { await revokePersonalAccessToken(lambdaTokenId, rootHeaders) } catch (e) {} }
  }
  resetState()
})

storyboardStep(Given, 'a freshly generated project whose .gitlab-ci.yml wires in the whole DevSecOps pipeline', async () => {
  project = renderProject()
  const ci = fs.readFileSync(`${project}/${CI_FILE}`, 'utf8')
  // Show the load-bearing part: the base image (version masked) and the local
  // includes that pull the whole pipeline in.
  const shown = ci
    .split('\n')
    .filter(l => l.startsWith('image:') || l.trimStart().startsWith('- local:') || l.trim() === 'include:')
    .join('\n')
    .replace(IMAGE_VERSION, '$1:<version>')
  await renderPreFrame(I, 'generated-ci-file', `$ grep -E 'image:|include:|- local:' .gitlab-ci.yml\n${shown}`)
  // Twin: the file really pulls the pipeline in from local include files.
  if (!/^\s*- local: \.config\/gitlab\/ci\/devsecops\/code\.yml/m.test(ci)) {
    throw new Error('Expected .gitlab-ci.yml to include the local DevSecOps code pipeline')
  }
  await createAndPushProject(project)
})

storyboardStep(Then, 'GitLab lints that config and reports it is valid', async () => {
  const lambdaHeaders = { 'PRIVATE-TOKEN': lambdaToken }
  const response = await lintProjectCi(projectName, lambdaHeaders)
  const { valid, errors } = response.data
  await renderPreFrame(
    I,
    'generated-ci-valid',
    `$ GET /projects/<project>/ci/lint?ref=main\n{\n  "valid": ${valid},\n  "errors": ${JSON.stringify(errors || [])}\n}`
  )
  // Twin: GitLab itself confirms the pushed config holds together.
  if (valid !== true) {
    throw new Error(`Expected valid CI config, got valid=${valid} errors=${JSON.stringify(errors)}`)
  }
})

// --- Scenario B: a real scoped runner runs the generated pipeline -------------

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Start one docker-executor runner scoped to this project and register it on the
// shared network so its job containers resolve http://gitlab. Returns the last
// line of the register output (the "registered successfully" confirmation).
async function startScopedRunner (rootHeaders) {
  const runner = await createProjectRunner(projectId, rootHeaders, [RUNNER_TAG])
  if (runner.status >= 400) {
    throw new Error(`createProjectRunner failed (${runner.status}): ${JSON.stringify(runner.data)}`)
  }
  runnerId = runner.data.id
  const glrt = runner.data.token
  runnerName = `e2e-runner-${crypto.randomBytes(4).toString('hex')}`
  const t0 = Date.now()
  const run = runCommandWithResult(
    `docker run -d --name ${runnerName} --network ${NET} ` +
    `-v /var/run/docker.sock:/var/run/docker.sock ${RUNNER_IMAGE}`
  )
  console.log(`[cycleE] runner container started (exit ${run.exitCode}) @${Date.now() - t0}ms`)
  if (run.exitCode !== 0) throw new Error(`docker run runner failed: ${run.stderr || run.stdout}`)
  const reg = runCommandWithResult(
    `docker exec ${runnerName} gitlab-runner register --non-interactive ` +
    `--url http://gitlab --token ${glrt} --executor docker ` +
    `--docker-image alpine:3.20 --docker-network-mode ${NET}`
  )
  const output = `${reg.stdout || ''}${reg.stderr || ''}`
  console.log(`[cycleE] runner registered (exit ${reg.exitCode}) @${Date.now() - t0}ms`)
  if (reg.exitCode !== 0) throw new Error(`gitlab-runner register failed: ${output}`)
  // The `gitlab-runner run` process started at the container entrypoint before
  // register wrote the [[runners]] into config.toml, and it does not always pick
  // the change up via fsnotify. Restart the container so it reloads the config
  // and starts polling — otherwise the job sits pending forever.
  const restart = runCommandWithResult(`docker restart ${runnerName}`)
  console.log(`[cycleE] runner restarted (exit ${restart.exitCode}) @${Date.now() - t0}ms`)
  if (restart.exitCode !== 0) throw new Error(`docker restart runner failed: ${restart.stderr || restart.stdout}`)
  await sleep(6000)
  return (output.split('\n').find(l => l.includes('registered successfully')) || 'Runner registered successfully.').trim()
}

// Poll the pipeline's jobs until TARGET_JOB reaches a terminal state or timeout.
async function pollTargetJob (headers, pipelineId) {
  const start = Date.now()
  let last = ''
  while (Date.now() - start < JOB_TIMEOUT_MS) {
    const jobs = (await listPipelineJobs(projectName, pipelineId, headers)).data || []
    const job = jobs.find(j => j.name === TARGET_JOB)
    const status = job ? job.status : 'absent'
    if (status !== last) {
      console.log(`[cycleE] ${TARGET_JOB}: ${status} @${Math.round((Date.now() - start) / 1000)}s`)
      last = status
    }
    if (job && ['success', 'failed', 'canceled', 'skipped'].includes(job.status)) return job
    await sleep(5000)
  }
  return null
}

storyboardStep(Given, 'a runner scoped to a freshly generated project comes online', async () => {
  project = renderProject()
  await createAndPushProject(project)
  const rootHeaders = await getRootHeaders()
  const confirmation = await startScopedRunner(rootHeaders)
  await renderPreFrame(
    I,
    'runner-online',
    `$ gitlab-runner register --url http://gitlab --executor docker\n${confirmation}`
  )
  // Twin: the runner registered (createAndPushProject/startScopedRunner throw on
  // any failure, so reaching here means the scoped runner is registered).
  if (!runnerId) throw new Error('Expected a scoped runner to be registered')
})

storyboardStep(Then, "the pipeline's first job runs on that runner and passes", async () => {
  const headers = { 'PRIVATE-TOKEN': lambdaToken }
  // The push already created a pipeline (workflow runs on the default branch);
  // it was pending for lack of a runner and starts now. Fall back to triggering
  // one if none is present yet.
  let pipelines = (await listProjectPipelines(projectName, headers)).data || []
  if (pipelines.length === 0) {
    const triggered = await triggerProjectPipeline(projectName, 'main', headers)
    pipelines = [triggered.data]
  }
  const pipelineId = pipelines[0].id
  console.log(`[cycleE] watching pipeline ${pipelineId} for ${TARGET_JOB}`)
  const job = await pollTargetJob(headers, pipelineId)
  const status = job ? job.status : 'timeout'
  if (status !== 'success') {
    // Surface the runner's own log — the fastest way to see why a job stalled
    // (useful when the embedded runner runs inside dind in CI).
    const logs = runCommandWithResult(`docker logs --tail 40 ${runnerName} 2>&1`)
    console.log(`[cycleE] runner log tail:\n${logs.stdout || logs.output || logs.stderr}`)
  }
  await renderPreFrame(
    I,
    'pipeline-job-green',
    `$ GET /projects/<project>/pipelines/<pid>/jobs\n{\n  "name": "${TARGET_JOB}",\n  "stage": "${TARGET_STAGE}",\n  "status": "${status}"\n}`
  )
  // Twin: a real job of the generated CI ran on a real runner and passed.
  if (status !== 'success') {
    throw new Error(`Expected ${TARGET_JOB} to pass, got status=${status}`)
  }
})
