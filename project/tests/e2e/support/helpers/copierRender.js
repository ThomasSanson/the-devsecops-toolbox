/**
 * Copier rendering helpers for the template-matrix and copier-update suites.
 *
 * Renders the WORKING-BRANCH template (the runner's /workspace, tarred without
 * .git by project:test:e2e) with arbitrary Copier answers, entirely inside the
 * codeceptjs container: the image pre-warms uv + Python 3.14 + copier 9.14.3
 * (.config/codeceptjs/Dockerfile), so a render needs no network and no GitLab.
 *
 * For `copier update` scenarios the working tree alone is not enough — update
 * requires a git-versioned template with tags. prepareVersionedTemplate()
 * copies /workspace into a throwaway git repo and tags two releases, the
 * second one carrying a marker change, mirroring what a real toolbox release
 * consumed by Renovate's postUpgradeTasks looks like.
 */
const crypto = require('crypto')
const { execSync } = require('child_process')

const TEMPLATE_SRC = '/workspace'
const COPIER = 'uvx --python 3.14 --from copier==9.14.3 copier'
const RENDER_TIMEOUT_MS = 300000

const UPDATE_MARKER_FILE = '.config/jq/Taskfile.yml'
const UPDATE_MARKER = '# e2e-update-marker'

function run (cmd, cwd) {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', timeout: RENDER_TIMEOUT_MS, ...(cwd ? { cwd } : {}) })
}

function tmpDir (prefix) {
  return `/tmp/${prefix}-${crypto.randomBytes(4).toString('hex')}`
}

function dataArgs (data = {}) {
  return Object.entries(data)
    .map(([key, value]) => `--data '${key}=${value}'`)
    .join(' ')
}

/**
 * Render the working-branch template with the given answers into a fresh
 * directory. Returns the destination path (caller removes it in After).
 */
function renderProject (data = {}) {
  const dst = tmpDir('e2e-render')
  run(`${COPIER} copy --defaults --skip-tasks --overwrite ${dataArgs(data)} ${TEMPLATE_SRC} ${dst}`)
  return dst
}

/**
 * Build a git-versioned copy of the working-branch template with two tagged
 * releases: `1.0.0` (the template as-is) and `1.0.1` (adds UPDATE_MARKER to
 * UPDATE_MARKER_FILE). Returns the template path.
 */
function prepareVersionedTemplate () {
  const tpl = tmpDir('e2e-template')
  // chown: the tar-extracted /workspace keeps the HOST uid; git refuses to
  // operate on a repo whose working dir belongs to another user (dubious
  // ownership), so align the copy with the runner's uid.
  run(`mkdir -p ${tpl} && cp -a ${TEMPLATE_SRC}/. ${tpl} && chown -R "$(id -u):$(id -g)" ${tpl}`)
  run('git init --quiet --initial-branch=main', tpl)
  run('git config user.email "e2e@test.local" && git config user.name "E2E"', tpl)
  run('git add -A && git commit --quiet --no-verify -m "chore: template release 1.0.0"', tpl)
  run('git tag 1.0.0', tpl)
  run(`printf '\\n%s\\n' '${UPDATE_MARKER}' >> ${UPDATE_MARKER_FILE}`, tpl)
  run('git add -A && git commit --quiet --no-verify -m "chore: template release 1.0.1"', tpl)
  run('git tag 1.0.1', tpl)
  return tpl
}

/**
 * Generate a project from a versioned template at the given release, and make
 * the destination a clean git repo (a copier update prerequisite).
 */
function renderProjectFromTemplate (tpl, vcsRef, data = {}) {
  const dst = tmpDir('e2e-project')
  run(`${COPIER} copy --defaults --skip-tasks --overwrite --vcs-ref ${vcsRef} ${dataArgs(data)} ${tpl} ${dst}`)
  run('git init --quiet --initial-branch=main', dst)
  run('git config user.email "e2e@test.local" && git config user.name "E2E"', dst)
  run('git add -A && git commit --quiet --no-verify -m "chore: initial render"', dst)
  return dst
}

/**
 * Run `copier update` on a generated project towards the given template
 * release — the exact path Renovate's postUpgradeTasks automates in every
 * generated project. Mirrors the real `task copier:update` invocation
 * (.config/copier/Taskfile.yml): the template stores its answers at a custom
 * location and declares _tasks, so update needs --answers-file and --trust.
 */
function updateProject (dst, vcsRef, data = {}) {
  run(
    `${COPIER} update --trust --defaults --skip-tasks --vcs-ref ${vcsRef} ` +
    `--answers-file .config/devsecops/.copier-answers.yml ${dataArgs(data)} ${dst}`
  )
}

function removeRendered (dir) {
  if (!dir || !dir.startsWith('/tmp/')) return
  try {
    run(`rm -rf ${dir}`)
  } catch (_) {
    // Best-effort cleanup.
  }
}

module.exports = {
  TEMPLATE_SRC,
  UPDATE_MARKER_FILE,
  UPDATE_MARKER,
  renderProject,
  prepareVersionedTemplate,
  renderProjectFromTemplate,
  updateProject,
  removeRendered
}
