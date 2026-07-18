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
const {
  bootstrapWorkspaceRepo,
  runTaskInRepoCaptured,
  buildGitLabTaskEnv
} = require('../helpers/workspaceRepo')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const { renderPreFrame, stripAnsi } = require('../helpers/capturedOutput')

const PROJECT_NAME = 'e2e-commit-hooks'
const REPO_DIR = `/tmp/${PROJECT_NAME}-repo`

let glabToken = null
let lastCommitOutput = ''
let lastCommitExitCode = null

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
    .replace(/\[(main|master|HEAD) [0-9a-f]{7,}\]/g, '[$1 <sha>]')
    .replace(/\(done in [\d.]+ seconds\)/g, '(done in <n>s)')
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
      { cwd: REPO_DIR, env: buildGitLabTaskEnv(glabToken), stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, encoding: 'utf8' }
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

storyboardStep(Given, 'a framework project has the commit hooks installed', {
  note: 'A freshly initialized project already has commit checks turned on: init installed a commit-msg hook, a script that runs before every commit message is accepted. The card proves the hook is there, not what it says.',
  copy: 'test -f .git/hooks/commit-msg && echo "commit-msg hook installed"'
}, async () => {
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
// Movement 1 — a conventional commit passes
// ============================================

storyboardStep(When, 'a developer writes a conventional commit message', {
  note: 'A conventional commit message follows a fixed pattern: a short type word, a colon, then a plain instruction — like "feat: add login page".',
  copy: 'feat: dogfood the commitlint hook'
}, async () => {
  await renderPreFrame(I, 'message-conventional', 'feat: dogfood the commitlint hook')
})

storyboardStep(Then, 'the hooks accept it and let the commit through', {
  note: 'The commit-msg hook calls commitlint, which accepts the message because it matches the pattern.',
  copy: 'git commit --allow-empty -m "feat: dogfood the commitlint hook"'
}, async () => {
  commit('feat: dogfood the commitlint hook')
  if (lastCommitExitCode !== 0) {
    throw new Error(`Expected the commit to pass the hooks, got exit ${lastCommitExitCode}\n--- output ---\n${lastCommitOutput}\n---`)
  }
  await renderPreFrame(I, 'commit-accepted', maskCommitOutput(lastCommitOutput).trimEnd())
})

// ============================================
// Movement 2 — a sloppy message is rejected
// ============================================

storyboardStep(When, 'a developer writes a sloppy commit message', {
  note: '"sloppy" is not one of the allowed type words, so commitlint is about to reject it.',
  copy: 'sloppy: skip the conventions'
}, async () => {
  await renderPreFrame(I, 'message-sloppy', 'sloppy: skip the conventions')
})

storyboardStep(Then, 'the hooks reject it with their own explanation', {
  note: 'commitlint blocks the commit and lists exactly which rules it broke.',
  copy: 'git commit --allow-empty -m "update stuff"'
}, async () => {
  commit('sloppy: skip the conventions')
  if (lastCommitExitCode === 0) {
    throw new Error(`Expected the commit to be rejected by the hooks, but it succeeded.\n--- output ---\n${lastCommitOutput}\n---`)
  }
  await renderPreFrame(I, 'commit-rejected', maskCommitOutput(lastCommitOutput).trimEnd())
})
