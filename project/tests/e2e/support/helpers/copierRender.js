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

// What a copier update prints that moves between two runs of the same story:
// the pinned copier in go-task's echo of the update (Renovate moves it every
// month), and the temporary checkout of the template its migrations run from.
const COPIER_RUN_MASKS = [
  [/copier==[0-9][\w.]*/g, 'copier==<version>'],
  [/copier\._vcs\.clone\.\w+/g, 'copier._vcs.clone.<tmp>']
]

const UPDATE_MARKER_FILE = '.config/jq/Taskfile.yml'
const UPDATE_MARKER = '# e2e-update-marker'

// The generated project's .gitlab-ci.yml pins the toolbox base image to a
// toolbox version. It is copied verbatim (no .jinja, not skip-if-exists), so a
// copier update overwrites it — the exact behaviour the toolbox-update story
// proves. The cspell-migration fixture stamps each tag's copy with the matching
// toolbox version so BEFORE/AFTER cards show the image moving 22.0.0 -> 22.7.1.
const CI_FILE = '.gitlab-ci.yml'
const CI_IMAGE_RE = /(image: registry\.gitlab\.com\/digital-commons\/devsecops\/the-devsecops-toolbox:)[0-9][^\n]*/

function pinCiImage (tpl, version) {
  const file = `${tpl}/${CI_FILE}`
  const content = fs.readFileSync(file, 'utf8')
  if (!CI_IMAGE_RE.test(content)) {
    throw new Error(`Fixture setup: no toolbox image line to pin in ${file}`)
  }
  fs.writeFileSync(file, content.replace(CI_IMAGE_RE, `$1${version}`))
}

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
 * directory, or into `dst` (its basename becomes the project slug). Returns the
 * destination path (caller removes it in After).
 */
function renderProject (data = {}, { dst = tmpDir('e2e-render') } = {}) {
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

// Release 22.7.1 of the cspell fixture also rewords one line of
// project/Taskfile.yml, a file copier lists under _skip_if_exists: the release
// changes it, and an update must still leave the project's own copy alone.
const TASKFILE_JINJA = 'project/Taskfile.yml.jinja'
const TASKFILE_LINE_BEFORE = 'This task is intended to run Terraform plan, database migrations check, etc.'
const TASKFILE_LINE_RELEASED = 'This task runs the Terraform plan and checks the database migrations.'
// The framework vocabulary of both releases: inline in config.json at 22.0.0,
// in config.base.json at 22.7.1, where the migration recognises it as the
// framework's own. The toolbox's real list moves every few days, and every
// picture of this fixture (a diff inside the list, its line counts, the height
// of the merge request's diff) would move with it.
const FIXTURE_FRAMEWORK_WORDS = ['glab', 'megalinter', 'uvx']

/**
 * Build a versioned template whose 22.0.0 is the OLD single-file cspell design
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
  // 22.0.0 — the OLD single-file design: the framework vocabulary lives inline in
  // config.json (which imports neither config.base.json nor config.project.json),
  // and none of the split files / migration exist. A project then has nowhere but
  // config.json to add its own words — exactly the situation #162's migration fixes.
  const oldCfg = JSON.parse(realCfg)
  oldCfg.import = oldCfg.import.filter(i => !i.includes('config.base.json') && !i.includes('config.project.json'))
  oldCfg.words = FIXTURE_FRAMEWORK_WORDS
  fs.writeFileSync(`${dir}/config.json`, JSON.stringify(oldCfg, null, 2) + '\n')
  for (const f of ['config.base.json', 'config.project.json', 'migrate-words.py']) fs.rmSync(`${dir}/${f}`, { force: true })
  // Remove the historical cspell migration, but retain the list header for
  // later migrations that are unrelated to this dictionary fixture.
  fs.writeFileSync(`${tpl}/copier.yml`, realCopier
    .replace(/\n# cspell vocabulary migration[\s\S]*?migrate-words\.py dedup"\n/, '\n_migrations:\n')
    .replace('  - .config/cspell/config.project.json\n', ''))
  // 22.0.0 pins its CI base image to the matching old toolbox version.
  pinCiImage(tpl, '22.0.0')
  run('git init --quiet --initial-branch=main', tpl)
  run('git config user.email "e2e@test.local" && git config user.name "E2E"', tpl)
  run('git add -A && git commit --quiet --no-verify -m "chore: release 22.0.0 (old single-file cspell)"', tpl)
  run('git tag 22.0.0', tpl)
  // 22.7.1 — the current split + migration, restored from the working tree,
  // its framework list pinned to the fixture's words.
  fs.writeFileSync(`${dir}/config.json`, realCfg)
  fs.writeFileSync(`${dir}/config.base.json`, JSON.stringify({ ...JSON.parse(realBase), words: FIXTURE_FRAMEWORK_WORDS }, null, 2) + '\n')
  fs.writeFileSync(`${dir}/config.project.json`, realOverride)
  fs.writeFileSync(`${dir}/migrate-words.py`, realMig)
  fs.writeFileSync(`${tpl}/copier.yml`, realCopier)
  // 22.7.1 moves the CI base image forward to the new toolbox version.
  pinCiImage(tpl, '22.7.1')
  const taskfile = `${tpl}/${TASKFILE_JINJA}`
  const tasks = fs.readFileSync(taskfile, 'utf8')
  if (!tasks.includes(TASKFILE_LINE_BEFORE)) throw new Error(`Fixture setup: no "${TASKFILE_LINE_BEFORE}" in ${taskfile}`)
  fs.writeFileSync(taskfile, tasks.replace(TASKFILE_LINE_BEFORE, TASKFILE_LINE_RELEASED))
  run('git add -A && git commit --quiet --no-verify -m "chore: release 22.7.1 (split cspell + migration)"', tpl)
  run('git tag 22.7.1', tpl)
  return tpl
}

/**
 * Build a git-versioned template whose ONLY change between 1.0.0 and 1.0.1 is the
 * CI base image line in .gitlab-ci.yml — a framework file that is NOT
 * skip-if-exists, so copier update 3-way merges it. When a project has itself
 * edited that same line, the two edits collide: the update-conflict story proves
 * the clash reaches the update merge request and can be settled there.
 */
function prepareConflictTemplate () {
  const tpl = tmpDir('e2e-conflict')
  run(`mkdir -p ${tpl} && cp -a ${TEMPLATE_SRC}/. ${tpl} && chown -R "$(id -u):$(id -g)" ${tpl}`)
  pinCiImage(tpl, '1.0.0')
  run('git init --quiet --initial-branch=main', tpl)
  run('git config user.email "e2e@test.local" && git config user.name "E2E"', tpl)
  run('git add -A && git commit --quiet --no-verify -m "chore: template release 1.0.0"', tpl)
  run('git tag 1.0.0', tpl)
  pinCiImage(tpl, '1.0.1')
  run('git add -A && git commit --quiet --no-verify -m "chore: template release 1.0.1 (bump CI image)"', tpl)
  run('git tag 1.0.1', tpl)
  return tpl
}

// The eight step-by-step guides releases before the move shipped as
// .agent/workflows/<name>.md, each the skill of the same name today.
const OLD_WORKFLOWS = ['create-feature', 'delete-feature', 'development-cycle', 'read-feature', 'tdd-step1-red', 'tdd-step2-green', 'tdd-step3-refactor', 'update-feature']
// What release 1.0.1 of the agents-move fixture adds to two toolbox rules the
// team never touches: one plain file, one rendered from a .jinja twin.
const AGENTS_MOVE_RELEASE_LINE = 'Release 1.0.1 adds this line.'
const AGENTS_MOVE_RELEASED_RULES = ['.agents/rules/tdd-cycle.md', '.agents/rules/tests-structure.md.jinja']

/**
 * Build a versioned template whose 1.0.0 keeps the AI agent files the way every
 * release before the move did: in .agent/, the guides in .agent/workflows/, no
 * .claude/skills links, and copier's excludes pointing into .agent/. Its 1.0.1
 * is the working tree, plus one line in two rules the team never touches, so
 * an update has toolbox changes to merge in the moved folder.
 */
function prepareAgentsMoveTemplate () {
  const tpl = tmpDir('e2e-agents-move')
  run(`mkdir -p ${tpl} && cp -a ${TEMPLATE_SRC}/. ${tpl} && chown -R "$(id -u):$(id -g)" ${tpl}`)
  run('git init --quiet --initial-branch=main', tpl)
  run('git config user.email "e2e@test.local" && git config user.name "E2E"', tpl)
  run(['mv .agents .agent', 'rm -rf .claude', 'mkdir -p .agent/workflows',
    ...OLD_WORKFLOWS.map(n => `for f in .agent/skills/${n}/SKILL.md*; do mv "$f" ".agent/workflows/${n}.md\${f##*SKILL.md}"; done && rmdir .agent/skills/${n}`)
  ].join(' && '), tpl)
  const copierYml = fs.readFileSync(`${tpl}/copier.yml`, 'utf8')
  fs.writeFileSync(`${tpl}/copier.yml`, copierYml.replaceAll('.agents/rules/', '.agent/rules/'))
  run('git add -A && git commit --quiet --no-verify -m "chore: template release 1.0.0 (.agent)"', tpl)
  run('git tag 1.0.0', tpl)
  run(`rm -rf .agent && cp -a ${TEMPLATE_SRC}/.agents ${TEMPLATE_SRC}/.claude ${TEMPLATE_SRC}/copier.yml .`, tpl)
  for (const rule of AGENTS_MOVE_RELEASED_RULES) fs.appendFileSync(`${tpl}/${rule}`, `\n${AGENTS_MOVE_RELEASE_LINE}\n`)
  run('git add -A && git commit --quiet --no-verify -m "chore: template release 1.0.1 (.agents)"', tpl)
  run('git tag 1.0.1', tpl)
  return tpl
}

const LYCHEE_CONFIG = '.config/lychee/config.toml'
// The release before the toolbox's lychee settings had an accept list of their
// own, and the release that brings it (the working tree).
const LYCHEE_RELEASE_BEFORE = '23.0.43'
const LYCHEE_RELEASE = '24.4.10'

/**
 * Build a versioned template whose LYCHEE_RELEASE_BEFORE ends its lychee
 * settings on the exclude_path list, as every release did before the toolbox
 * accepted status codes of its own, and whose LYCHEE_RELEASE is the working
 * tree, accept list included. A project that wrote its own accept list in that
 * file sees the release add a second one.
 */
function prepareLycheeAcceptTemplate () {
  const tpl = tmpDir('e2e-lychee-accept')
  run(`mkdir -p ${tpl} && cp -a ${TEMPLATE_SRC}/. ${tpl} && chown -R "$(id -u):$(id -g)" ${tpl}`)
  // The test toolbox ships the migration with LYCHEE_RELEASE, whatever release
  // the real toolbox ships it in.
  const copierYml = fs.readFileSync(`${tpl}/copier.yml`, 'utf8')
  const gated = copierYml.replace(/version: "[^"]+"(\n\s+command: [^\n]*merge-lychee-keys\.py)/, `version: "${LYCHEE_RELEASE}"$1`)
  if (gated === copierYml) throw new Error('Fixture setup: no versioned merge-lychee-keys.py migration in copier.yml')
  fs.writeFileSync(`${tpl}/copier.yml`, gated)
  const file = `${tpl}/${LYCHEE_CONFIG}`
  const current = fs.readFileSync(file, 'utf8')
  const before = current.match(/^[\s\S]*?^exclude_path = \[[\s\S]*?^\]\n/m)
  if (!before || !/^accept = /m.test(current.slice(before[0].length))) {
    throw new Error(`Fixture setup: no accept list after exclude_path in ${file}`)
  }
  fs.writeFileSync(file, before[0])
  run('git init --quiet --initial-branch=main', tpl)
  run('git config user.email "e2e@test.local" && git config user.name "E2E"', tpl)
  run(`git add -A && git commit --quiet --no-verify -m "chore: template release ${LYCHEE_RELEASE_BEFORE}"`, tpl)
  run(`git tag ${LYCHEE_RELEASE_BEFORE}`, tpl)
  fs.writeFileSync(file, current)
  run(`git add -A && git commit --quiet --no-verify -m "chore: template release ${LYCHEE_RELEASE} (accept list)"`, tpl)
  run(`git tag ${LYCHEE_RELEASE}`, tpl)
  return tpl
}

/**
 * Generate a project from a versioned template at the given release, and make
 * the destination a clean git repo (a copier update prerequisite).
 */
function renderProjectFromTemplate (tpl, vcsRef, data = {}, { dst = tmpDir('e2e-project') } = {}) {
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
  COPIER_RUN_MASKS,
  UPDATE_MARKER_FILE,
  UPDATE_MARKER,
  TASKFILE_LINE_RELEASED,
  OLD_WORKFLOWS,
  AGENTS_MOVE_RELEASE_LINE,
  LYCHEE_CONFIG,
  LYCHEE_RELEASE_BEFORE,
  LYCHEE_RELEASE,
  renderProject,
  prepareVersionedTemplate,
  prepareCspellMigrationTemplate,
  prepareConflictTemplate,
  prepareAgentsMoveTemplate,
  prepareLycheeAcceptTemplate,
  renderProjectFromTemplate,
  updateProject,
  removeRendered
}
