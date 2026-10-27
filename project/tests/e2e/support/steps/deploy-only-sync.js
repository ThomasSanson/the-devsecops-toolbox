/* global inject Given Then After */
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { copyFramework } = require('../helpers/frameworkCopy')
const { openLocalTerminal } = require('../helpers/localTerminal')
const { terminalCard } = require('../terminal/capture')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const { syncFixture, runTask, git, write } = require('../helpers/deployOnlyFixture')
const { I } = inject()

const DIR = '/tmp/e2e-deploy-only-contract'
const SETTING = 'TASK_DEVSECOPS_TEST_DEPLOY_PATHS'
let closeTerminal
let env
let syncState

After(test => {
  if (!test?.tags?.includes('@deploy-only-paths')) return
  if (closeTerminal) closeTerminal()
  closeTerminal = null
})

After(async test => {
  if (!test?.tags?.includes('@deploy-only-sync')) return
  if (syncState?.closeTerminal) syncState.closeTerminal()
  if (syncState?.pub) await syncState.pub.teardown()
  syncState = null
})

storyboardStep(Given, 'a deployment policy with literal paths and dotenv overrides', async () => {
  fs.rmSync(DIR, { recursive: true, force: true })
  fs.mkdirSync(DIR, { recursive: true })
  copyFramework(DIR)
  fs.writeFileSync(path.join(DIR, '.env.dist'), `${SETTING}='deploy/\ncharts/values-prod.yaml'\n`)
  fs.writeFileSync(path.join(DIR, '.env.dev'), `${SETTING}='overrides/'\n`)
  env = { ...process.env }
  for (const key of [SETTING, 'TASK_E2E_UPDATE_BASELINES', 'TASK_CODECEPTJS_GREP', 'TASK_CODECEPTJS_FEATURES']) delete env[key]
  closeTerminal = await openLocalTerminal(I, { cwd: DIR, env, port: 7717, height: 700 })
  const screen = await terminalCard(I, 'dotenv-paths', 'cat .env.dist .env.dev')
  assert.ok(screen.includes('charts/values-prod.yaml') && screen.includes('overrides/'))
})

storyboardStep(Then, 'unsafe paths keep the full pipeline and the effective dotenv value is read without writing YAML', async () => {
  const contract = spawnSync('task', ['project:test:deployment-only:contract'], { cwd: DIR, env, encoding: 'utf8' })
  assert.equal(contract.status, 0, contract.stdout + contract.stderr)
  const yamlBefore = fs.readFileSync(path.join(DIR, '.gitlab-ci.yml'))
  const pattern = () => spawnSync('task', ['--silent', 'devsecops:plan:deploy-only:pattern'], { cwd: DIR, env, encoding: 'utf8' })
  const overridden = pattern()
  assert.equal(overridden.status, 0, overridden.stderr)
  assert.equal(overridden.stdout.trim(), '\\A(?!(?:overrides/))')
  fs.writeFileSync(path.join(DIR, '.env.dev'), `${SETTING}=''\n`)
  const empty = pattern()
  assert.equal(empty.status, 0, empty.stderr)
  assert.equal(empty.stdout.trim(), '\\A')
  assert.equal(empty.stderr, '')
  fs.writeFileSync(path.join(DIR, '.env.dev'), '')
  assert.equal(pattern().stdout.trim(), '\\A(?!(?:deploy/|charts/values-prod\\.yaml\\z))')
  assert.deepEqual(fs.readFileSync(path.join(DIR, '.gitlab-ci.yml')), yamlBefore)
  const screen = await terminalCard(I, 'safe-path-contract',
    'cat .env.dist .env.dev && task --silent project:test:deployment-only:contract && task --silent devsecops:plan:deploy-only:pattern && TASK_DEVSECOPS_TEST_DEPLOY_PATHS=project/Taskfile.yml task --silent devsecops:plan:deploy-only:pattern', {
      mask: [[/Ran (\d+) tests in [0-9.]+s/g, 'Ran $1 tests in <duration>']]
    })
  assert.ok(screen.includes('charts/values-prod'))
  assert.ok(screen.includes('OK') && screen.replace(/\r?\n/g, '').includes('the full pipeline remains enabled'))
})

storyboardStep(Given, 'a default branch plan with a project API token and deployment paths', async () => {
  syncState = await syncFixture('/tmp/e2e-deploy-only-sync')
  assert.equal((await syncState.variable()).status, 404)
  syncState.closeTerminal = await openLocalTerminal(I, { cwd: syncState.dir, env: syncState.env, port: 7718, height: 900 })
  const screen = await terminalCard(I, 'sync-configuration', 'cat .env.dist')
  assert.ok(screen.includes('charts/values-prod.yaml'))
})

storyboardStep(Then, 'plan publishes and verifies the deployment policy in GitLab', async () => {
  const result = runTask(syncState, 'plan')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const variable = await syncState.variable()
  assert.equal(variable.status, 200, 'A successful default-branch plan must create the project variable')
  assert.equal(variable.data.value, '\\A(?!(?:deploy/|charts/values-prod\\.yaml\\z))')
  for (const [key, value] of Object.entries({ raw: true, protected: false, masked: false, environment_scope: '*', variable_type: 'env_var' })) {
    assert.equal(variable.data[key], value)
  }
  const screen = await terminalCard(I, 'verified-policy', 'task plan')
  assert.ok(screen.includes('Deployment policy is already synchronized'))
  assert.ok(!screen.includes(syncState.env.TASK_COMMITIZEN_TOKEN))
})

storyboardStep(Then, 'a later default branch plan repairs the policy even without a configuration change', async () => {
  write(syncState.dir, '.env.dist', `${SETTING}='charts/'\n`)
  git(syncState.dir, 'add', '.env.dist')
  git(syncState.dir, 'commit', '-qm', 'chore: narrow deployment paths')
  syncState.pub.push('trunk')
  syncState.env.CI_COMMIT_SHA = git(syncState.dir, 'rev-parse', 'HEAD')
  const updated = runTask(syncState, 'plan')
  assert.equal(updated.status, 0, updated.stdout + updated.stderr)
  assert.equal((await syncState.variable()).data.value, '\\A(?!(?:charts/))')
  // Corrupt only the stored variable: an unchanged configuration must repair it.
  const { updateProjectVariable } = require('../helpers/gitlabApi')
  const changed = await updateProjectVariable(syncState.pub.projectName, 'TASK_DEVSECOPS_DEPLOY_ONLY_REGEXP', { value: '\\A' }, syncState.pub.headers)
  assert.equal(changed.status, 200)
  const screen = await terminalCard(I, 'repaired-policy', 'CI_COMMIT_SHA=$(git rev-parse HEAD) task plan')
  assert.equal((await syncState.variable()).data.value, '\\A(?!(?:charts/))')
  assert.ok(screen.includes('Deployment policy synchronized and verified'))
})

storyboardStep(Then, 'temporary failures retry within bounds while obsolete or unauthorized plans cannot write', async () => {
  const result = runTask(syncState, 'project:test:deployment-only:contract', 'TASK_DEPLOY_ONLY_CONTRACT_CASE=sync')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const screen = await terminalCard(I, 'bounded-retries', 'task --silent project:test:deployment-only:contract TASK_DEPLOY_ONLY_CONTRACT_CASE=sync', {
    mask: [[/Ran (\d+) tests in [0-9.]+s/g, 'Ran $1 tests in <duration>']]
  })
  assert.ok(screen.includes('OK'))
})
