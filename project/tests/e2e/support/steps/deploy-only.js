/* global inject Given Then After */
/**
 * Storyboard for @deploy-only (see features/02-daily-work/deploy-only.feature).
 *
 * The test job of a merge request asks .config/devsecops/scripts/check-deploy-only.sh
 * whether the change only touches deployment files. Exit 0 skips the suite,
 * anything else runs it. This story runs that script, the exact line the job
 * runs, against a throwaway git repository shaped like a project: two
 * deployment folders, some code and a test. Each card sets up one merge
 * request off camera, then types ONE line in a real terminal (ttyd, see
 * helpers/localTerminal.js): what the merge request changes, the script's
 * answer and its exit code.
 *
 * The script needs nothing but git, bash and the setting, so the fixture
 * carries only the framework's scripts and its .env.dist, both taken from the
 * working tree under test.
 *
 * ONE Gherkin sentence = ONE card = ONE pixel baseline, asserted inside the step
 * (tolerance: 0); every card twins its frame with a check of the same fact (exit
 * code and the reason the script gives, read outside the terminal).
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { REPO } = require('../helpers/frameworkCopy')
const { openLocalTerminal } = require('../helpers/localTerminal')
const { terminalCard } = require('../terminal/capture')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const { I } = inject()

// One scenario owns this directory, so two workers never share it. Fixed path:
// it shows in the prompt of every card.
const FIXTURE = '/tmp/e2e-deploy-only'
const SETTING = 'TASK_DEVSECOPS_TEST_DEPLOY_PATHS'
const OVERLAY = 'project/kustomize/overlays/production/kustomization.yaml'
const CHECK = 'bash .config/devsecops/scripts/check-deploy-only.sh'
// What GitLab hands a merge request pipeline: the commit the change is measured
// against. Every merge request here branches from the tip of the main branch.
const IN_MR = `CI_MERGE_REQUEST_DIFF_BASE_SHA=$(git rev-parse main) ${CHECK}`
const EXIT = 'echo "exit code $?"'

// A small project: two deployment folders, the code they ship, and its test.
const PROJECT = {
  [OVERLAY]: [
    'apiVersion: kustomize.config.k8s.io/v1beta1',
    'kind: Kustomization',
    'resources:',
    '  - ../../base',
    'images:',
    '  - name: registry.example.org/app/api',
    '    newTag: 1.4.0',
    '  - name: registry.example.org/app/web',
    '    newTag: 1.4.0',
    ''
  ].join('\n'),
  'project/kustomize/base/kustomization.yaml': 'resources:\n  - deployment.yaml\n',
  'project/argocd/application.yaml': 'apiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata:\n  name: app\n',
  'project/src/app.js': "module.exports = () => 'hello'\n",
  'project/tests/app.test.js': "require('../src/app')\n"
}

let story = null

function sh (cmd) {
  return execSync(cmd, { cwd: FIXTURE, env: story.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd()
}

// The twin: the same script, run outside the terminal.
function run (cmd) {
  try {
    return { output: execSync(`${cmd} 2>&1`, { cwd: FIXTURE, env: story.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }), code: 0 }
  } catch (e) {
    return { output: String(e.stdout || ''), code: e.status == null ? 1 : e.status }
  }
}

function write (file, content) {
  fs.mkdirSync(path.dirname(path.join(FIXTURE, file)), { recursive: true })
  fs.writeFileSync(path.join(FIXTURE, file), content)
}

function edit (file, from, to) {
  const content = fs.readFileSync(path.join(FIXTURE, file), 'utf8')
  if (!content.includes(from)) throw new Error(`Fixture setup: ${JSON.stringify(from)} not found in ${file}`)
  write(file, content.split(from).join(to))
}

// The release itself: both image tags move from 1.4.0 to 1.5.0.
const shipRelease = () => edit(OVERLAY, 'newTag: 1.4.0', 'newTag: 1.5.0')

// A fresh merge request branch from the tip of the main branch, carrying only
// the changes given, so each card measures exactly one merge request.
function mergeRequest (...changes) {
  sh('git checkout -q -B release main')
  changes.forEach(change => change())
  sh('git add -A && git commit -qm "the merge request"')
}

// One card: the line typed on camera ends on the script's answer and its exit
// code. The twin runs the script again outside the terminal and checks both
// agree.
async function card (frameName, before, checkCmd) {
  const screen = await terminalCard(I, frameName, [...before, checkCmd, EXIT].join('; '))
  const verdict = run(checkCmd)
  if (!screen.includes(`exit code ${verdict.code}`)) {
    throw new Error(`The terminal and the twin disagree on the exit code (twin: ${verdict.code}):\n${screen}`)
  }
  return { screen, verdict }
}

function expectSuiteRuns ({ screen, verdict }, reason) {
  if (verdict.code === 0 || !verdict.output.includes('The test suite runs') || !verdict.output.includes(reason) || !screen.includes(reason)) {
    throw new Error(`Expected the test suite to run because ${JSON.stringify(reason)}, got exit ${verdict.code}:\n${verdict.output}\n--- screen ---\n${screen}`)
  }
}

After((test) => {
  if (!(test && test.tags && test.tags.includes('@deploy-only'))) return
  if (story && story.closeTerminal) story.closeTerminal()
  for (const leftover of [FIXTURE, `${FIXTURE}.gitconfig`]) {
    try { fs.rmSync(leftover, { recursive: true, force: true }) } catch (_) {}
  }
  story = null
})

// ---------------------------------------------------------------------------
// Chapter 1: a release that only moves image tags
// ---------------------------------------------------------------------------

storyboardStep(Given, 'a merge request that changes nothing but an image tag in a deployment folder', async () => {
  fs.rmSync(FIXTURE, { recursive: true, force: true })
  fs.mkdirSync(path.join(FIXTURE, '.config/devsecops'), { recursive: true })
  fs.cpSync(path.join(REPO, '.config/devsecops/scripts'), path.join(FIXTURE, '.config/devsecops/scripts'), { recursive: true })
  fs.copyFileSync(path.join(REPO, '.env.dist'), path.join(FIXTURE, '.env.dist'))
  Object.entries(PROJECT).forEach(([file, content]) => write(file, content))

  // An isolated global config, outside the fixture: the shared ~/.gitconfig
  // stays untouched, and no stray file sits in the merge request.
  const gitConfig = `${FIXTURE}.gitconfig`
  fs.writeFileSync(gitConfig, '[safe]\n\tdirectory = *\n[user]\n\temail = e2e@test.local\n\tname = e2e\n[init]\n\tdefaultBranch = main\n')
  const env = { ...process.env, GIT_CONFIG_GLOBAL: gitConfig }
  // The suite's own environment must not answer for the merge request.
  for (const name of ['CI_MERGE_REQUEST_DIFF_BASE_SHA', 'CI_MERGE_REQUEST_TARGET_BRANCH_NAME', 'BASE', SETTING,
    'TASK_E2E_UPDATE_BASELINES', 'TASK_CODECEPTJS_GREP', 'TASK_CODECEPTJS_FEATURES']) delete env[name]
  story = { env }
  sh('git init -q && git add -A && git commit -qm "the project as it stands"')
  mergeRequest(shipRelease)

  story.closeTerminal = await openLocalTerminal(I, { cwd: FIXTURE, env, port: 7710, height: 800 })
  const screen = await terminalCard(I, 'a-release-moves-image-tags', 'ls project && git diff main...HEAD')
  for (const said of ['argocd', 'kustomize', '-    newTag: 1.4.0', '+    newTag: 1.5.0']) {
    if (!screen.includes(said)) throw new Error(`Expected the release card to show ${JSON.stringify(said)}:\n${screen}`)
  }
  const changed = sh('git diff --name-only main...HEAD')
  if (changed !== OVERLAY) throw new Error(`Expected the merge request to change only ${OVERLAY}, got:\n${changed}`)
})

storyboardStep(Then, 'with no deployment folder named, the test suite runs as before', async () => {
  const seen = await card('no-folder-named-tests-run', [`grep '^${SETTING}=' .env.dist`], IN_MR)
  expectSuiteRuns(seen, `${SETTING} is empty`)
})

storyboardStep(Then, 'once the main branch names the deployment folders, the same merge request skips the test suite', async () => {
  sh('git checkout -q main')
  edit('.env.dist', `${SETTING}=\n`, `${SETTING}="project/kustomize project/argocd"\n`)
  sh('git commit -qam "name the deployment folders"')
  mergeRequest(shipRelease)

  const { screen, verdict } = await card('deployment-only-skips-tests', [
    `git show main:.env.dist | grep '^${SETTING}='`,
    'git diff --stat main...HEAD'
  ], IN_MR)
  if (verdict.code !== 0 || !verdict.output.includes('the test suite is skipped') || !screen.includes('the test suite is skipped')) {
    throw new Error(`Expected the script to skip the test suite, got exit ${verdict.code}:\n${verdict.output}`)
  }
})

// ---------------------------------------------------------------------------
// Chapter 2: anything else still runs the test suite
// ---------------------------------------------------------------------------

storyboardStep(Then, 'a merge request that also changes a test runs the test suite', async () => {
  mergeRequest(shipRelease, () => edit('project/tests/app.test.js', "require('../src/app')", "require('../src/app')()"))
  const seen = await card('a-test-changed-tests-run', ['git diff --stat main...HEAD'], IN_MR)
  expectSuiteRuns(seen, 'project/tests/app.test.js is outside the deployment folders')
})

storyboardStep(Then, 'a merge request that changes the setting itself runs the test suite', async () => {
  mergeRequest(
    () => edit('.env.dist', `${SETTING}="project/kustomize project/argocd"`, `${SETTING}="project/kustomize project/argocd project/src"`),
    () => edit('project/src/app.js', "'hello'", "'hello, world'")
  )
  // Only the setting's own lines: the rest of .env.dist moves with every
  // toolbox release and has nothing to do with this card.
  const settingDiff = `git diff main...HEAD -- .env.dist | grep '^[-+]${SETTING}='`
  const seen = await card('the-setting-changed-tests-run', [settingDiff, 'git diff --stat main...HEAD'], IN_MR)
  const setting = run(settingDiff).output
  if (!setting.includes(`+${SETTING}="project/kustomize project/argocd project/src"`)) {
    throw new Error(`Expected the merge request to add project/src to the setting, got:\n${setting}`)
  }
  expectSuiteRuns(seen, '.env.dist is outside the deployment folders')
})

// ---------------------------------------------------------------------------
// Chapter 3: when in doubt, the test suite runs
// ---------------------------------------------------------------------------

storyboardStep(Then, 'outside a merge request the test suite always runs', async () => {
  // The merge request that skipped the suite two chapters ago, run without a
  // merge request around it.
  mergeRequest(shipRelease)
  const seen = await card('outside-a-merge-request-tests-run', [], CHECK)
  expectSuiteRuns(seen, 'not a merge request pipeline')
})

storyboardStep(Then, 'when the change cannot be computed the test suite runs', async () => {
  const seen = await card('unknown-diff-tests-run', [], `CI_MERGE_REQUEST_DIFF_BASE_SHA=${'0'.repeat(40)} ${CHECK}`)
  expectSuiteRuns(seen, 'cannot compute the diff')
})
