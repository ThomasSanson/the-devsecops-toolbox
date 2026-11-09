/* global inject Given Then After */
/**
 * @shipped-tables: every Markdown table the toolbox ships passes
 * markdown-table-formatter.
 *
 * The base MegaLinter settings turn the formatter off, but a project that
 * sets its own DISABLE_LINTERS replaces that list and runs it again. The
 * compact table of .config/devsecops/deployment-only.md then failed such a
 * project's upgrade (issue #368). A project generated with every default
 * answer sets its own list and runs `task megalinter` on its Markdown files,
 * all of them shipped by the toolbox.
 */
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { renderProject } = require('../helpers/copierRender')
const { openLocalTerminal } = require('../helpers/localTerminal')
const {
  terminalCard, clearTerminal, typeCommandAndWait, captureTerminalFrame, terminalScreenText
} = require('../terminal/capture')
const { addStoryboardFrame, storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const { I } = inject()

const TAG = '@shipped-tables'
// Fixed path: the prompt prints it on every card.
const PROJECT = '/tmp/e2e-shipped-tables'
const CONFIG = '.config/megalinter/config.yml'
const GUIDE = '.config/devsecops/deployment-only.md'
// MegaLinter names each linter's log <key>-<status>.log.
const FORMATTER_LOG = 'megalinter-reports/linters_logs/MARKDOWN_MARKDOWN_TABLE_FORMATTER-SUCCESS.log'
// The project's own list of disabled linters, without the formatter, a
// formatter error that fails the run as in the project of issue #368, and the
// Markdown checks alone: no network pre-command, no clean-up commands, no
// flavour advice under the summary.
const OWN_LIST = [
  'DISABLE_LINTERS: [COPYPASTE_JSCPD]',
  'FORMATTERS_DISABLE_ERRORS: false',
  'ENABLE: [MARKDOWN]',
  'PRE_COMMANDS: []',
  'POST_COMMANDS: []',
  'FLAVOR_SUGGESTIONS: false'
]
const RUN = 'task megalinter; echo "exit code $?"'
// One MegaLinter container per run, padded to one width so the masked name
// leaves the wrapped lines where they are.
const CONTAINER = `e2e-shipped-tables-${String(process.pid).padStart(7, '0')}`
// What moves between two runs: durations, the container name, the size of
// the reports docker copies back, and the versions a Renovate bump moves.
// The reporters' lines move above or below the summary from one machine to
// the next: the card leaves them out.
const RUN_DROP = [/^\[SARIF Reporter\]/, /^\[Updated Sources Reporter\]/]
const RUN_MASKS = [
  [/ - \(\d+(?:\.\d+)?s\)/g, ''],
  [/(Successfully copied )[\d.]+[kMG]?B/g, '$1<size>'],
  [/ \d+(?:\.\d+)?s {2,}\|/g, ' <elapsed>    |'],
  [new RegExp(CONTAINER, 'g'), '<container>'],
  [/(megalinter\.io\/)\d+\.\d+\.\d+/g, '$1<version>'],
  [/(\[markdownlint v)[\d.]+\]/g, '$1<version>]'],
  [/(\[markdown-table-formatter v)[\d.]+\]/g, '$1<version>]']
]

let story = null

After((test) => {
  if (!(test && test.tags && test.tags.includes(TAG))) return
  if (story && story.closeTerminal) story.closeTerminal()
  execSync(`docker rm -f ${CONTAINER} >/dev/null 2>&1 || true`)
  fs.rmSync(PROJECT, { recursive: true, force: true })
  story = null
})

const git = (args) => execSync(`git ${args}`, { cwd: PROJECT, encoding: 'utf8' })

storyboardStep(Given, 'a generated project sets its own list of disabled linters, so the table formatter runs again', async () => {
  fs.rmSync(PROJECT, { recursive: true, force: true })
  renderProject({}, { dst: PROJECT })
  assert.ok(fs.existsSync(path.join(PROJECT, GUIDE)), `The generated project must ship ${GUIDE}`)
  fs.appendFileSync(path.join(PROJECT, CONFIG), `\n${OWN_LIST.join('\n')}\n`)
  git('init --quiet --initial-branch=main')
  git('config user.email "e2e@test.local" && git config user.name "E2E"')
  git('add -A && git commit --quiet --no-verify -m "chore: set our own list of disabled linters"')

  story = { env: { ...process.env, TASK_MEGALINTER_CONTAINER_NAME: CONTAINER } }
  delete story.env.TASK_E2E_UPDATE_BASELINES
  story.closeTerminal = await openLocalTerminal(I, { cwd: PROJECT, env: story.env, port: 7719, height: 1200, width: 1440 })
  const screen = await terminalCard(I, 'own-disabled-linters', `tail -n ${OWN_LIST.length} ${CONFIG}`)
  for (const said of OWN_LIST) {
    assert.ok(screen.includes(said), `Expected the project's own settings on screen, with "${said}":\n${screen}`)
  }
})

storyboardStep(Then, 'markdown-table-formatter accepts every Markdown table the toolbox ships', async () => {
  await clearTerminal(I)
  await typeCommandAndWait(I, RUN, 600000)
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'formatter-accepts-shipped-tables', { fromMarker: 'Linted [MARKDOWN]', mask: RUN_MASKS, drop: RUN_DROP }))
  const screen = await terminalScreenText(I)
  for (const said of ['files with [markdown-table-formatter] successfully', 'exit code 0']) {
    assert.ok(screen.includes(said), `Expected the formatter to pass and "exit code 0", with "${said}":\n${screen}`)
  }
  // The same fact on disk: the formatter ran and passed.
  assert.ok(fs.existsSync(path.join(PROJECT, FORMATTER_LOG)), `The formatter must have run and passed, leaving ${FORMATTER_LOG}`)
  assert.equal(git('status --porcelain --untracked-files=no'), '', 'The run must change no file of the project')
})
