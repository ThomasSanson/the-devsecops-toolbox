/* global inject Given Then Before After */
/**
 * Generated-CI storyboard — proves the .gitlab-ci.yml a vanilla project ships is
 * valid: GitLab itself lints the config a freshly generated project pushes.
 *
 * The suite stopped at "MR opened + config posted": nothing proved the generated
 * CI plan is even valid. Here we render a vanilla project, create a project on
 * the embedded GitLab, push the tree, and ask GitLab itself whether the config
 * is valid (GET /ci/lint, the fast deterministic guardrail). That a REAL runner
 * executes the WHOLE generated pipeline to green — and the framework merge
 * request merges on it — is proven end to end by the @install-complete story, so
 * it is not duplicated here. ONE Gherkin sentence = ONE card = ONE pixel baseline
 * (tolerance: 0); every card twins its frame with a real REST fact.
 */
const { I } = inject()
const crypto = require('crypto')
const fs = require('fs')
const { execSync } = require('child_process')
const { renderProject, removeRendered } = require('../helpers/copierRender')
const { renderPreFrame } = require('../helpers/capturedOutput')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const {
  getRootHeaders,
  createProject,
  deleteProject,
  createLambdaPersonalAccessToken,
  revokePersonalAccessToken,
  lintProjectCi
} = require('../helpers/gitlabApi')

const CI_FILE = '.gitlab-ci.yml'
// The toolbox base-image version moves on every framework release; mask it so
// the card stays pixel-stable while still proving the image points at the
// toolbox and the pipeline is wired in from local includes.
const IMAGE_VERSION = /(the-devsecops-toolbox):[^\s]+/

let project
let projectName
let lambdaToken
let lambdaTokenId

function git (dir, cmd) {
  return execSync(`git -C ${dir} ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

// Create a public project owned by the lambda user and push the rendered tree to
// its main branch, so GitLab can resolve the `local:` includes and lint the
// pipeline. Returns nothing; throws on push failure without leaking the PAT.
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
}

Before(resetState)

After(async () => {
  if (project) removeRendered(project)
  if (projectName || lambdaTokenId) {
    const rootHeaders = await getRootHeaders()
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
