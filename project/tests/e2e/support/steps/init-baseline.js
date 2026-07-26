/* global inject Given When Then */
/**
 * Commit-hooks storyboard — the toolbox's own commitlint + lefthook chain as
 * ONE developer journey: a freshly initialized project carries the installed
 * commit-msg hook, a conventional commit sails through it, a sloppy one is
 * turned back with commitlint's own explanation. ONE Gherkin sentence = ONE
 * storyboard card = ONE pixel baseline, asserted inside the step
 * (tolerance: 0); each verdict card twins its <pre> frame with a
 * programmatic exit-code assert of the same fact.
 */

const { I, GitLabProjectPage, GitLabUserPage } = inject()
const { execSync } = require('child_process')
const {
  BASE_URL,
  projectPath,
  getRootHeaders,
  createLambdaPersonalAccessToken
} = require('../helpers/gitlabApi')
const fs = require('fs')
const {
  bootstrapWorkspaceRepo,
  runTaskInRepoCaptured,
  buildGitLabTaskEnv
} = require('../helpers/workspaceRepo')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const { renderPreFrame, stripAnsi } = require('../helpers/capturedOutput')

const PROJECT_NAME = 'e2e-commit-hooks'
const REPO_DIR = `/tmp/${PROJECT_NAME}-repo`
const CLONE_DIR = `/tmp/${PROJECT_NAME}-clone`

let glabToken = null
let lastCommitOutput = ''
let lastCommitExitCode = null
// Where the commit cards run. Starts in the init repo (hooks installed by
// init); the teammate-clone steps move it to the bare clone, so the accept /
// reject cards prove the hooks of a clone that ran `task dev` — not the
// original's.
let hooksRepoDir = REPO_DIR

// Masks the dynamic short SHA so "[main abc1234] message" becomes
// "[main <sha>] message", and lefthook's own elapsed time so
// "(done in 1.20 seconds)" becomes "(done in <n>s)" — keeps the contract
// visible without churn. Also drops two sources of non-deterministic noise:
// lefthook's own "sync hooks: ..." line (prints only when its checksum is
// stale) and uvx's dependency spinner, which reprints a
// "Resolving dependencies..." line a variable number of times depending on
// resolution timing — never content the commitlint verdict being proven
// cares about.
function maskCommitOutput (raw) {
  return stripAnsi(raw)
    .replace(/\[[\w./-]+ [0-9a-f]{7,}\]/g, '[<branch> <sha>]')
    .replace(/\(done in [\d.]+ seconds\)/g, '(done in <n>s)')
    // The hooks echo the command they run, pinned version and all, and lefthook
    // prints its own banner. Both numbers move whenever Renovate bumps the tool,
    // and this story is about a commit message being accepted or rejected — not
    // about which commitizen ran that week. Masked, the picture stops breaking
    // on updates that change nothing it means to show.
    .replace(/commitizen==[0-9][\w.]*/g, 'commitizen==<version>')
    .replace(/lefthook v[0-9][\w.]*/g, 'lefthook v<version>')
    .split('\n')
    .filter(line => {
      const trimmed = line.trim()
      if (/^sync hooks: /.test(trimmed)) return false
      if (trimmed.includes('Resolving dependencies')) return false
      return true
    })
    .join('\n')
}

// The lefthook binary lives on the PATH built by dev:setup-environment
// (~/.local/bin), not on the bare Node process PATH — without it, the
// commit-msg hook silently no-ops instead of running commitlint. `2>&1`
// merges the hook's stderr into the same captured stream on both the
// success AND failure path.
function commit (message) {
  try {
    const output = execSync(
      `git commit --allow-empty -m ${JSON.stringify(message)} 2>&1`,
      { cwd: hooksRepoDir, env: buildGitLabTaskEnv(glabToken), stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, encoding: 'utf8' }
    )
    lastCommitOutput = output
    lastCommitExitCode = 0
  } catch (error) {
    lastCommitOutput = error.stdout || ''
    lastCommitExitCode = error.status || 1
  }
}

// ============================================
// Given — the hooks are installed
// ============================================

storyboardStep(Given, 'a framework project has the commit hooks installed', async () => {
  await GitLabProjectPage.deleteProjectIfExists(
    BASE_URL,
    process.env.TASK_GITLAB_ROOT_USER,
    process.env.TASK_GITLAB_ROOT_PASSWORD,
    projectPath(PROJECT_NAME)
  )
  await GitLabUserPage.loginAs(process.env.TASK_GITLAB_LAMBDA_USER, process.env.TASK_GITLAB_LAMBDA_PASSWORD)
  await GitLabProjectPage.createBlankPublicProject(PROJECT_NAME)

  const rootHeaders = await getRootHeaders()
  const { token } = await createLambdaPersonalAccessToken(
    `glab-cli-token-for-${PROJECT_NAME}`,
    ['api', 'write_repository'],
    rootHeaders
  )
  glabToken = token

  bootstrapWorkspaceRepo(PROJECT_NAME, REPO_DIR, glabToken, { runInit: false, timeout: 300000 })
  let result = runTaskInRepoCaptured('task devsecops:init', REPO_DIR, glabToken, { timeout: 300000 })
  if (result.exitCode === 201) {
    result = runTaskInRepoCaptured('task devsecops:init', REPO_DIR, glabToken, { timeout: 300000 })
  }
  if (result.exitCode !== 0) {
    throw new Error(`task devsecops:init failed with exit code ${result.exitCode}`)
  }

  // Prove the hook EXISTS — don't dump its ~60 lines of lefthook boilerplate.
  // The command throws (and the step fails loud) if the hook was never installed.
  const proof = execSync(
    'test -f .git/hooks/commit-msg && echo "commit-msg hook installed"',
    { cwd: REPO_DIR, encoding: 'utf8' }
  ).trimEnd()
  await renderPreFrame(I, 'hooks-installed', `$ test -f .git/hooks/commit-msg && echo "commit-msg hook installed"\n${proof}`)

  // Warm the commit-hook caches once, off-camera. The FIRST commit that runs
  // the commit-msg hook pays two one-time, non-deterministic costs: uv's
  // cold-cache download wall for commitizen (dozens of "Preparing packages…"
  // progress lines) and lefthook's initial "sync hooks" checksum write. Doing
  // it here — on a throwaway commit that is immediately unwound — means the
  // captured commits below always show the short, deterministic warm output.
  commit('chore: warm the commit-hook caches')
  if (lastCommitExitCode !== 0) {
    throw new Error(`Cache warm-up commit failed unexpectedly (exit ${lastCommitExitCode})\n${lastCommitOutput}`)
  }
  execSync('git reset --soft HEAD~1', { cwd: REPO_DIR, env: buildGitLabTaskEnv(glabToken) })
})

// ============================================
// Movement 0b — a bare clone has NO hooks until task dev turns them on
// ============================================

storyboardStep(When, 'a teammate clones the same project bare, with no commit hooks yet', async () => {
  hooksRepoDir = REPO_DIR
  execSync(`rm -rf ${CLONE_DIR}`)
  // Off-camera: land the framework in the repo's history so the clone carries
  // it (the bootstrap only COPIES the working tree; nothing was committed).
  execSync(
    'git add -A && git commit --no-verify --quiet -m "chore: bring the framework aboard"',
    { cwd: REPO_DIR, env: buildGitLabTaskEnv(glabToken), stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }
  )
  const repoDirName = REPO_DIR.split('/').pop()
  const cloneDirName = CLONE_DIR.split('/').pop()
  // A local clone makes the lesson exact: it is GIT that never copies
  // .git/hooks on clone — no server involved. Output is fully deterministic
  // ("Cloning into '…'… done.").
  const cloneOut = stripAnsi(execSync(
    `git clone ${repoDirName} ${cloneDirName} 2>&1`,
    { cwd: '/tmp', env: buildGitLabTaskEnv(glabToken), stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, encoding: 'utf8' }
  )).trimEnd()
  // Off-camera: a real developer has a global git identity; the test container
  // does not, and the accept/reject commits below will run from this clone.
  execSync('git config user.email "lambda@test.local" && git config user.name "Lambda"', { cwd: CLONE_DIR })
  // Twins FIRST: main already carries the framework (init pushed it), yet git
  // must NOT have activated any commit-msg hook on clone.
  if (!fs.existsSync(`${CLONE_DIR}/Taskfile.yml`)) {
    throw new Error('Expected the clone to carry the framework on main (no Taskfile.yml)')
  }
  const lsOut = execSync('ls Taskfile.yml', { cwd: CLONE_DIR, encoding: 'utf8' }).trimEnd()
  const proof = execSync(
    'test -f .git/hooks/commit-msg || echo "no commit-msg hook yet"',
    { cwd: CLONE_DIR, encoding: 'utf8' }
  ).trimEnd()
  if (proof !== 'no commit-msg hook yet') {
    throw new Error('Expected the bare clone to have NO commit-msg hook, but one is already there')
  }
  await renderPreFrame(I, 'clone-no-hooks', [
    `$ git clone ${repoDirName} ${cloneDirName}`,
    cloneOut,
    `$ cd ${cloneDirName} && ls Taskfile.yml`,
    lsOut,
    '$ test -f .git/hooks/commit-msg || echo "no commit-msg hook yet"',
    proof
  ].join('\n'))
})

storyboardStep(Then, 'task dev:setup-environment turns the hooks on, exactly as the dev container does on build', async () => {
  const result = runTaskInRepoCaptured('task dev:setup-environment', CLONE_DIR, glabToken, { timeout: 600000 })
  if (result.exitCode !== 0) {
    throw new Error(`task dev:setup-environment failed in the bare clone (exit ${result.exitCode})\n${(result.output || '').slice(-2000)}`)
  }
  // The setup prints tool-by-tool detail (versions, "already installed") that
  // varies per image; the fixed phase-marker lines are the deterministic
  // skeleton worth showing.
  const phases = stripAnsi(result.output || '').split('\n').filter(l =>
    /Starting development environment setup|Lefthook:install phase completed successfully|Development environment setup completed successfully/.test(l)
  ).map(l => l.trim())
  const proof = execSync(
    'test -f .git/hooks/commit-msg && echo "commit-msg hook installed"',
    { cwd: CLONE_DIR, encoding: 'utf8' }
  ).trimEnd()
  await renderPreFrame(I, 'clone-hooks-on', [
    '$ task dev:setup-environment',
    ...phases,
    '$ test -f .git/hooks/commit-msg && echo "commit-msg hook installed"',
    proof
  ].join('\n'))
  // From here every commit card runs in the teammate's clone.
  hooksRepoDir = CLONE_DIR
})

// ============================================
// Movement 1 — a conventional commit passes
// ============================================

storyboardStep(When, 'a developer writes a conventional commit message', async () => {
  await renderPreFrame(I, 'message-conventional', 'feat: dogfood the commitlint hook')
})

storyboardStep(Then, 'the hooks accept it and let the commit through', async () => {
  commit('feat: dogfood the commitlint hook')
  if (lastCommitExitCode !== 0) {
    throw new Error(`Expected the commit to pass the hooks, got exit ${lastCommitExitCode}\n--- output ---\n${lastCommitOutput}\n---`)
  }
  await renderPreFrame(I, 'commit-accepted', maskCommitOutput(lastCommitOutput).trimEnd())
})

// ============================================
// Movement 2 — a sloppy message is rejected
// ============================================

storyboardStep(When, 'a developer writes a sloppy commit message', async () => {
  await renderPreFrame(I, 'message-sloppy', 'sloppy: skip the conventions')
})

storyboardStep(Then, 'the hooks reject it with their own explanation', async () => {
  commit('sloppy: skip the conventions')
  if (lastCommitExitCode === 0) {
    throw new Error(`Expected the commit to be rejected by the hooks, but it succeeded.\n--- output ---\n${lastCommitOutput}\n---`)
  }
  await renderPreFrame(I, 'commit-rejected', maskCommitOutput(lastCommitOutput).trimEnd())
})
