const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')
const { toolboxRepository } = require('./frameworkCopy')
const { publishToGitLab } = require('./gitlabProject')
const { BASE_URL, createProjectAccessToken, readProjectVariable } = require('./gitlabApi')
const { settlePage } = require('./gitlabCard')

const SETTING = 'TASK_DEVSECOPS_TEST_DEPLOY_PATHS'
const VARIABLE = 'TASK_DEVSECOPS_DEPLOY_ONLY_REGEXP'

function write (dir, file, contents) {
  const target = path.join(dir, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, contents)
}

function git (dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function runTask (fixture, ...args) {
  return spawnSync('task', args, { cwd: fixture.dir, env: fixture.env, encoding: 'utf8' })
}

async function resetFileTreeScroll (I) {
  // GitLab scrolls the selected blob into view inside its separate Files panel.
  // Keep the actual tree visible, with a repeatable starting scroll position.
  await I.executeScript(() => {
    const tree = document.querySelector('nav.repository-tree-list')
    if (!tree) throw new Error('The repository file tree must be loaded')
    tree.querySelectorAll('*').forEach(node => { node.scrollTop = 0 })
    for (let node = tree; node; node = node.parentElement) node.scrollTop = 0
    window.scrollTo(0, 0)
  })
  await settlePage(I)
}

async function syncFixture (dir) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  toolboxRepository(dir)
  git(dir, 'checkout', '-qb', 'trunk')
  write(dir, '.env.dist', `${SETTING}='deploy/\ncharts/values-prod.yaml'\n`)
  write(dir, '.env.dev', '')
  write(dir, '.gitlab-ci.yml', 'workflow:\n  rules:\n    - when: never\nfixture:\n  script: echo fixture\n')
  const pub = await publishToGitLab(dir, { branch: 'trunk', project: { shared_runners_enabled: false } })
  try {
    const token = await createProjectAccessToken(pub.projectName, {
      name: 'deployment-policy',
      scopes: ['api'],
      access_level: 40,
      expires_at: new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    }, pub.headers)
    assert.equal(token.status, 201, 'The disposable project must provide an API token')
    const env = { ...process.env }
    for (const key of [SETTING, 'TASK_E2E_UPDATE_BASELINES', 'TASK_CODECEPTJS_GREP', 'TASK_CODECEPTJS_FEATURES', 'CI_COMMIT_TAG', 'CI_MERGE_REQUEST_IID']) delete env[key]
    Object.assign(env, {
      CI: 'true',
      CI_COMMIT_BRANCH: 'trunk',
      CI_DEFAULT_BRANCH: 'trunk',
      CI_COMMIT_SHA: git(dir, 'rev-parse', 'HEAD'),
      CI_API_V4_URL: `${BASE_URL}/api/v4`,
      CI_PROJECT_ID: String(pub.projectId),
      TASK_COMMITIZEN_TOKEN: token.data.token
    })
    return { dir, pub, env, variable: () => readProjectVariable(pub.projectName, VARIABLE, pub.headers) }
  } catch (error) {
    await pub.teardown()
    throw error
  }
}

module.exports = { SETTING, VARIABLE, write, git, runTask, syncFixture, resetFileTreeScroll }
