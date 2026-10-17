/* global inject Given When Then After */
// cspell:ignore lycheeignore
/**
 * @lychee-settings: a framework update must leave lychee able to read its own
 * settings. A project generated before the toolbox accepted status codes of its
 * own wrote its accept list in the toolbox's lychee file, and the release that
 * adds the toolbox's list merges cleanly and sets accept twice: TOML refuses
 * that, and lychee stops before checking a single link (#227).
 *
 * Every card is a real ttyd terminal in THIS container (helpers/localTerminal.js),
 * where `task megalinter` can reach Docker. ONE Gherkin sentence = ONE card = ONE
 * pixel baseline, asserted inside the step (tolerance: 0), each twinned with a
 * check of the same fact: git, the settings parsed as TOML, MegaLinter's reports.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const {
  COPIER, COPIER_RUN_MASKS, LYCHEE_CONFIG, LYCHEE_RELEASE_BEFORE, LYCHEE_RELEASE,
  prepareLycheeAcceptTemplate, renderProjectFromTemplate, removeRendered
} = require('../helpers/copierRender')
const { openLocalTerminal } = require('../helpers/localTerminal')
const { terminalCard } = require('../terminal/capture')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const { I } = inject()

const TAG = '@lychee-settings'
// Fixed: the prompt shows it on every card.
const ROOT = '/tmp/lychee-settings'
const PROJECT = `${ROOT}/my-project`
const ANSWERS = '.config/devsecops/.copier-answers.yml'
const MEGALINTER_CONFIG = '.config/megalinter/config.yml'
const IGNORE_FILE = '.lycheeignore'
const PAGE = 'docs/services.md'
const DEAD_LINK = 'http://127.0.0.2:9/status'
const LYCHEE_REPORT = 'megalinter-reports/linters_logs/SPELL_LYCHEE-ERROR.log'

// Off camera: MegaLinter runs lychee alone, on the one page of this story. The
// generated project's other pages link to the internet, and the hooks install
// spell-checker dictionaries lychee does not need.
const LINKS_ONLY = [
  '',
  'ENABLE_LINTERS: [SPELL_LYCHEE]',
  "SPELL_LYCHEE_FILTER_REGEX_INCLUDE: '(^|/)docs/services\\.md$'",
  'PRE_COMMANDS: []',
  'POST_COMMANDS: []',
  ''
].join('\n')

// The developer's own commit: the accept list a project had to write before
// the toolbox accepted 429 itself, the address of a local service in the file
// lychee reads from the repository root, and a page linking to both.
const OWN_ACCEPT = 'accept = [\n  200,\n  206,\n  403,\n  429\n]\n\n'
const OWN_IGNORE = '^http://storage(:[0-9]+)?/\n'
const OWN_PAGE = `# Services\n\n- [Storage console](http://storage:9000/)\n- [Old status page](${DEAD_LINK})\n`
const OWN_COMMIT = 'docs: link our local services'

const SHOW = 'git show --format=%s'
const UPDATE = 'task copier:update TASK_COPIER_CLI_OPTS=--defaults'
const DIFF = `git diff -- ${LYCHEE_CONFIG}`
const LINT = `task megalinter > /dev/null 2>&1 || cat ${LYCHEE_REPORT}`
const MIGRATED = `[lychee migration] accept was set twice in ${LYCHEE_CONFIG}: merged into one list`

// Blob ids move with any change of the toolbox's lychee settings; what the
// diff says does not.
const DIFF_MASKS = [[/\bindex [0-9a-f]{7,}\.\.[0-9a-f]{7,}/g, 'index <sha>..<sha>']]
// Copier runs a migration with its own interpreter, which lives in uv's cache.
const UPDATE_MASKS = [...COPIER_RUN_MASKS, [/\/\S+\/bin\/python[0-9.]*/g, '<copier-python>']]
// MegaLinter's report names the versions Renovate moves.
const REPORT_MASKS = [
  [/lychee linter \(version [0-9.]+\)/g, 'lychee linter (version <version>)'],
  [/(megalinter\.io\/)\d+\.\d+\.\d+/g, '$1<version>']
]

// Copier's own Python: the twin parses the settings as lychee does, as TOML.
const PYTHON = [...COPIER.replace(/ copier$/, '').split(' '), 'python']
const READ_TOML = 'import json, sys, tomllib; print(json.dumps(tomllib.load(open(sys.argv[1], "rb"))))'

let story = null

After((test) => {
  if (!(test && test.tags && test.tags.includes(TAG))) return
  if (story) {
    if (story.closeTerminal) story.closeTerminal()
    removeRendered(story.template)
  }
  fs.rmSync(ROOT, { recursive: true, force: true })
  story = null
})

function git (...args) {
  return execFileSync('git', args, { cwd: PROJECT, encoding: 'utf8' })
}

function readToml (file) {
  try {
    return JSON.parse(execFileSync(PYTHON[0], [...PYTHON.slice(1), '-c', READ_TOML, file],
      { cwd: PROJECT, encoding: 'utf8', stdio: 'pipe', timeout: 120000 }))
  } catch (err) {
    assert.fail(`${file} is no longer valid TOML, so lychee cannot read it:\n${err.stderr || err.message}`)
  }
}

// The suite's own switches must not reach the shell: the update and the lint
// run the same way locally and in CI.
function terminalEnv () {
  const env = { ...process.env, TASK_COPIER_COMMAND: COPIER, TASK_MEGALINTER_CONTAINER_NAME: `ml-lychee-${process.pid}` }
  for (const name of ['TASK_E2E_UPDATE_BASELINES', 'TASK_CODECEPTJS_GREP', 'TASK_CODECEPTJS_FEATURES', 'CI']) delete env[name]
  return env
}

// Off camera: the project generated from the release before the toolbox's
// accept list, its MegaLinter settings cut down to lychee, then the developer's
// commit. On camera: that commit as git shows it. The twins: the commit holds
// those three files, and the screen shows each change.
storyboardStep(Given, 'the developer kept their own accepted status codes in the toolbox\'s lychee settings, and their own address in .lycheeignore', async () => {
  story = {}
  fs.rmSync(ROOT, { recursive: true, force: true })
  fs.mkdirSync(ROOT)
  story.template = prepareLycheeAcceptTemplate()
  renderProjectFromTemplate(story.template, LYCHEE_RELEASE_BEFORE, {}, { dst: PROJECT })
  fs.appendFileSync(path.join(PROJECT, MEGALINTER_CONFIG), LINKS_ONLY)
  git('commit', '-q', '--amend', '--no-edit', '--no-verify', '--', MEGALINTER_CONFIG)
  const settings = path.join(PROJECT, LYCHEE_CONFIG)
  assert.ok(!/^accept\s*=/m.test(fs.readFileSync(settings, 'utf8')), `Release ${LYCHEE_RELEASE_BEFORE} must have no accept list of its own`)
  fs.writeFileSync(settings, OWN_ACCEPT + fs.readFileSync(settings, 'utf8'))
  fs.writeFileSync(path.join(PROJECT, IGNORE_FILE), OWN_IGNORE)
  fs.mkdirSync(path.join(PROJECT, path.dirname(PAGE)), { recursive: true })
  fs.writeFileSync(path.join(PROJECT, PAGE), OWN_PAGE)
  git('add', '-A')
  git('commit', '-q', '--no-verify', '-m', OWN_COMMIT)
  assert.equal(git('status', '--porcelain'), '', 'The project must start clean')

  story.closeTerminal = await openLocalTerminal(I, { cwd: PROJECT, env: terminalEnv(), port: 7695, height: 1000 })
  const screen = await terminalCard(I, 'own-settings', SHOW, { mask: DIFF_MASKS })
  assert.deepEqual(git('show', '--name-only', '--format=', 'HEAD').trim().split('\n'), [LYCHEE_CONFIG, IGNORE_FILE, PAGE],
    'The developer\'s commit must hold their settings, their ignore file and their page')
  for (const said of [OWN_COMMIT, '+accept = [', '+  403,', `+${OWN_IGNORE.trim()}`, `+- [Old status page](${DEAD_LINK})`]) {
    assert.ok(screen.includes(said), `The commit must show ${said}:\n${screen}`)
  }
})

// The developer's real update command, from the clean main branch. The twins:
// the project records the new release, the settings still parse as TOML, and
// the release's migration said what it did.
storyboardStep(When, 'the developer updates the project to the release that adds the toolbox\'s own accept list', async () => {
  const screen = await terminalCard(I, 'update', UPDATE, { mask: UPDATE_MASKS })
  for (const said of [`Updating to template version ${LYCHEE_RELEASE}`, 'Copier update completed successfully.']) {
    assert.ok(screen.includes(said), `The update must say ${said}:\n${screen}`)
  }
  const answers = fs.readFileSync(path.join(PROJECT, ANSWERS), 'utf8')
  assert.match(answers, new RegExp(`^_commit: ${LYCHEE_RELEASE.replaceAll('.', '\\.')}$`, 'm'), `The project must record release ${LYCHEE_RELEASE}`)
  readToml(LYCHEE_CONFIG)
  assert.ok(screen.includes(MIGRATED), `The release's migration must say what it merged:\n${screen}`)
})

// What the update changed in the lychee settings. The twins: one accept list,
// the developer's codes and the toolbox's range in it, and nothing else of the
// project's touched.
storyboardStep(Then, 'the lychee settings keep one accept list, with the developer\'s codes and the toolbox\'s', async () => {
  const screen = await terminalCard(I, 'one-accept-list', DIFF, { mask: DIFF_MASKS })
  const text = fs.readFileSync(path.join(PROJECT, LYCHEE_CONFIG), 'utf8')
  assert.equal((text.match(/^accept\s*=/gm) || []).length, 1, `accept must be set once:\n${text}`)
  assert.deepEqual(readToml(LYCHEE_CONFIG).accept, [200, 206, 403, 429, '200..=299'],
    'The accept list must keep the developer\'s codes and the toolbox\'s range')
  assert.deepEqual(git('status', '--porcelain').split('\n').filter(Boolean).map(line => line.slice(3)).sort(), [ANSWERS, LYCHEE_CONFIG].sort(),
    'The update must change the answers and the lychee settings, nothing else')
  assert.equal(fs.readFileSync(path.join(PROJECT, IGNORE_FILE), 'utf8'), OWN_IGNORE, `${IGNORE_FILE} must stay the developer's`)
  for (const said of ['-accept = [', '+  403,', IGNORE_FILE]) {
    assert.ok(screen.includes(said), `The diff must show ${said}:\n${screen}`)
  }
})

// MegaLinter, cut down to lychee off camera, and the report it leaves when
// lychee fails. The twins: the report names the dead link and only it,
// MegaLinter handed lychee the toolbox's settings and found the project's
// ignore file, and nothing refused the settings.
storyboardStep(Then, 'lychee reads its settings, skips the address in .lycheeignore and reports the dead link', async () => {
  const screen = await terminalCard(I, 'lychee-report', LINT, { mask: REPORT_MASKS })
  const reports = path.join(PROJECT, 'megalinter-reports')
  assert.ok(!fs.existsSync(path.join(reports, 'linters_logs/SPELL_LYCHEE-SUCCESS.log')), 'lychee must fail on the dead link')
  const report = fs.readFileSync(path.join(PROJECT, LYCHEE_REPORT), 'utf8')
  for (const said of ['Excluded.........1', 'Errors...........1', `[ERROR] ${DEAD_LINK}`]) {
    assert.ok(report.includes(said), `lychee's report must say ${said}:\n${report}`)
  }
  assert.ok(!report.includes('storage'), `lychee must leave the address in ${IGNORE_FILE} alone:\n${report}`)
  const log = fs.readFileSync(path.join(reports, 'megalinter.log'), 'utf8')
  for (const said of [`Ignore file: [/${IGNORE_FILE}]`, `--config /tmp/lint/${LYCHEE_CONFIG}`]) {
    assert.ok(log.includes(said), `MegaLinter's log must say ${said}`)
  }
  assert.ok(!log.includes('duplicate key'), 'lychee must accept its settings')
  assert.ok(screen.includes(`[ERROR] ${DEAD_LINK}`), `The card must show the dead link:\n${screen}`)
})
