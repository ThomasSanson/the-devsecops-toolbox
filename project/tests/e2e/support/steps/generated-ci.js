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
const { I, GitLabUserPage } = inject()
const crypto = require('crypto')
const fs = require('fs')
const { execSync } = require('child_process')
const { renderProject, removeRendered } = require('../helpers/copierRender')
const { renderPreFrame } = require('../helpers/capturedOutput')
const {
  storyboardStep,
  addStoryboardFrame,
  captureElementFrame
} = require('../../../../../.config/codeceptjs/storyboard')
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

// GitLab's own pipeline editor lints the .gitlab-ci.yml live and shows a green
// "Pipeline syntax is correct" verdict. Log in as the lambda owner (the editor
// is a member view), open it on main, wait for the verdict text to appear
// (wording-tolerant), tag its row and crop the frame to it — the volatile top
// app bar and avatars are hidden so the card stays pixel-stable.
async function captureCiEditorValidity () {
  await GitLabUserPage.loginAs(process.env.TASK_GITLAB_LAMBDA_USER, process.env.TASK_GITLAB_LAMBDA_PASSWORD)
  I.resizeWindow(1024, 640)
  const user = process.env.TASK_GITLAB_LAMBDA_USER
  await I.amOnPage(`/${user}/${projectName}/-/ci/editor`)
  await I.waitForElement('body', 30)

  // The verdict appears once the editor parses the file. Poll for it rather than
  // a single literal so a wording change (GitLab version) still finds it.
  const deadline = Date.now() + 45000
  let found = false
  while (Date.now() < deadline && !found) {
    found = await I.executeScript(() => {
      const PHRASES = ['syntax is correct', 'configuration is valid', 'ci configuration is valid']
      return Array.from(document.querySelectorAll('span, div, p, a, small, strong'))
        .some(el => {
          const t = el.textContent.trim().toLowerCase()
          return t.length <= 140 && PHRASES.some(p => t.includes(p))
        })
    })
    if (!found) await I.wait(2)
  }
  if (!found) throw new Error('The pipeline editor never showed a "syntax is correct" verdict')

  await I.executeScript(() => {
    ;['header', '.super-topbar', '[data-testid="top-bar"]', 'nav.navbar'].forEach(sel => {
      const n = document.querySelector(sel)
      if (n) n.style.visibility = 'hidden'
    })
    document.querySelectorAll('img').forEach(el => { el.style.visibility = 'hidden' })
    const PHRASES = ['syntax is correct', 'configuration is valid', 'ci configuration is valid']
    let hit = null
    for (const el of document.querySelectorAll('span, div, p, a, small, strong')) {
      const t = el.textContent.trim().toLowerCase()
      if (t.length <= 140 && PHRASES.some(p => t.includes(p))) { hit = el; break }
    }
    if (hit) {
      // Walk up until the row also holds the status icon, so the crop reads as
      // GitLab's own green verdict (check + text), not bare text.
      let box = hit
      for (let i = 0; i < 3 && box.parentElement; i++) {
        if (box.querySelector('svg')) break
        box = box.parentElement
      }
      box.id = 'storyboard-ci-valid'
    }
  })
  await I.moveCursorTo('body', 1, 1)
  await I.wait(0.5)
  await addStoryboardFrame(I, await captureElementFrame(I, 'generated-ci-valid', '#storyboard-ci-valid'))
  I.resizeWindow(1024, 768)
}

storyboardStep(Then, 'GitLab lints that config and reports it is valid', async () => {
  const lambdaHeaders = { 'PRIVATE-TOKEN': lambdaToken }
  const response = await lintProjectCi(projectName, lambdaHeaders)
  const { valid, errors } = response.data
  // Twin FIRST: GitLab's own lint API confirms the pushed config holds together.
  if (valid !== true) {
    throw new Error(`Expected valid CI config, got valid=${valid} errors=${JSON.stringify(errors)}`)
  }
  // The proof is GitLab's own pipeline editor showing the config is valid.
  await captureCiEditorValidity()
})
