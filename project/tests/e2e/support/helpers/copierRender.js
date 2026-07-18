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
const fs = require('fs')
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
 * Build a versioned template whose 22.7.0 is the OLD single-file cspell design
 * (base words inline in config.json, no split, no migration) and whose 22.7.1 is
 * the current split + auto-migration. Tags bracket the copier `_migrations`
 * version (22.7.1) so the migration actually fires on update — proving that a
 * project which kept its words in config.json gets them moved to its own
 * config.project.json while config.json becomes the framework image.
 */
function prepareCspellMigrationTemplate () {
  const tpl = tmpDir('e2e-cspell-mig')
  run(`mkdir -p ${tpl} && cp -a ${TEMPLATE_SRC}/. ${tpl} && chown -R "$(id -u):$(id -g)" ${tpl}`)
  const dir = `${tpl}/.config/cspell`
  const realCfg = fs.readFileSync(`${TEMPLATE_SRC}/.config/cspell/config.json`, 'utf8')
  const realBase = fs.readFileSync(`${TEMPLATE_SRC}/.config/cspell/config.base.json`, 'utf8')
  const realOverride = fs.readFileSync(`${TEMPLATE_SRC}/.config/cspell/config.project.json`, 'utf8')
  const realMig = fs.readFileSync(`${TEMPLATE_SRC}/.config/cspell/migrate-words.py`, 'utf8')
  const realCopier = fs.readFileSync(`${TEMPLATE_SRC}/copier.yml`, 'utf8')
  // 22.0.0 — the OLD single-file design: the base vocabulary lives inline in
  // config.json (which imports neither config.base.json nor config.project.json),
  // and none of the split files / migration exist. A project then has nowhere but
  // config.json to add its own words — exactly the situation #162's migration fixes.
  const oldCfg = JSON.parse(realCfg)
  oldCfg.import = oldCfg.import.filter(i => !i.includes('config.base.json') && !i.includes('config.project.json'))
  oldCfg.words = JSON.parse(realBase).words
  fs.writeFileSync(`${dir}/config.json`, JSON.stringify(oldCfg, null, 2) + '\n')
  for (const f of ['config.base.json', 'config.project.json', 'migrate-words.py']) fs.rmSync(`${dir}/${f}`, { force: true })
  fs.writeFileSync(`${tpl}/copier.yml`, realCopier
    .replace(/\n# cspell vocabulary migration[\s\S]*?migrate-words\.py dedup"\n/, '\n')
    .replace('  - .config/cspell/config.project.json\n', ''))
  run('git init --quiet --initial-branch=main', tpl)
  run('git config user.email "e2e@test.local" && git config user.name "E2E"', tpl)
  run('git add -A && git commit --quiet --no-verify -m "chore: release 22.0.0 (old single-file cspell)"', tpl)
  run('git tag 22.0.0', tpl)
  // 22.7.1 — the current split + migration, restored from the working tree.
  fs.writeFileSync(`${dir}/config.json`, realCfg)
  fs.writeFileSync(`${dir}/config.base.json`, realBase)
  fs.writeFileSync(`${dir}/config.project.json`, realOverride)
  fs.writeFileSync(`${dir}/migrate-words.py`, realMig)
  fs.writeFileSync(`${tpl}/copier.yml`, realCopier)
  run('git add -A && git commit --quiet --no-verify -m "chore: release 22.7.1 (split cspell + migration)"', tpl)
  run('git tag 22.7.1', tpl)
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
  // 2>&1 so the migration scripts' own announcements (printed during the update)
  // are captured whether copier streams them to stdout or stderr; the caller can
  // read them back to prove which migration actions fired.
  return run(
    `${COPIER} update --trust --defaults --skip-tasks --vcs-ref ${vcsRef} ` +
    `--answers-file .config/devsecops/.copier-answers.yml ${dataArgs(data)} ${dst} 2>&1`
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
  COPIER,
  UPDATE_MARKER_FILE,
  UPDATE_MARKER,
  renderProject,
  prepareVersionedTemplate,
  prepareCspellMigrationTemplate,
  renderProjectFromTemplate,
  updateProject,
  removeRendered
}
