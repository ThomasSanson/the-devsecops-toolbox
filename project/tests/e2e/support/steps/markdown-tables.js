/* global inject Given Then After */
/**
 * @markdown-tables: MegaLinter keeps a table with emoji the way markdownlint
 * reads it.
 *
 * markdownlint's MD060 lines pipes up by screen columns, where ✅ takes two.
 * markdown-table-formatter padded them by characters, where ✅ counts one, so
 * it rewrote every such table into one MD060 then flagged: two runs of the
 * gate never agreed. A generated project holds the table twice, lined up on
 * screen and padded by character count, and runs `task megalinter` twice. The
 * first run (off camera) must hand no fixed file back; the second (the card)
 * must reach the same verdict, with MD060 still flagging the padded copy.
 */
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { renderProject } = require('../helpers/copierRender')
const { runTask } = require('../helpers/taskProcess')
const { stripAnsiEscapeSequences } = require('../helpers/docker')
const { openLocalTerminal } = require('../helpers/localTerminal')
const {
  terminalCard, clearTerminal, typeCommandAndWait, captureTerminalFrame, terminalScreenText
} = require('../terminal/capture')
const { addStoryboardFrame, storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const { I } = inject()

const TAG = '@markdown-tables'
// Fixed path: the prompt prints it on every card.
const PROJECT = '/tmp/e2e-markdown-tables'
const CONFIG = '.config/megalinter/config.yml'
const ON_SCREEN = 'docs/status.md'
const BY_COUNT = 'docs/status-by-count.md'
const HANDED_BACK = 'megalinter-reports/updated_sources'
const LOG = 'megalinter-reports/megalinter.log'
const NOTHING_FIXED = 'No source file has been formatted or fixed'
// ✅ and ❌ take two columns on screen, so their cells get one space less.
const ON_SCREEN_BODY = '# Status\n\n| Tool | Status |\n| ---- | ------ |\n| task | ✅     |\n| glab | ❌     |\n'
// The same table as markdown-table-formatter 1.7.0 rewrites it.
const BY_COUNT_BODY = '# Status\n\n| Tool | Status |\n|------|--------|\n| task | ✅      |\n| glab | ❌      |\n'
// The Markdown checks on the two tables, and nothing else: no network
// pre-command, no clean-up commands, no flavour advice under the summary.
const MARKDOWN_ONLY = [
  'ENABLE: [MARKDOWN]',
  'FILTER_REGEX_INCLUDE: (docs/status)',
  'PRE_COMMANDS: []',
  'POST_COMMANDS: []',
  'FLAVOR_SUGGESTIONS: false'
]
const RUN = 'task megalinter; echo "exit code $?"'
// One MegaLinter container per run: two stories side by side on one Docker
// daemon must not remove each other's.
// Padded to one width: the masked name must leave the wrapped lines where
// they are, whatever the length of the process number.
const CONTAINER = `e2e-markdown-tables-${String(process.pid).padStart(7, '0')}`
// What moves between two runs: durations, the container name, the size of
// the reports docker copies back, and the MegaLinter and markdownlint versions
// a Renovate bump moves.
// MegaLinter prints its reporters' lines above or below the summary depending
// on the machine: the card leaves them out, and the step still reads
// "No source file has been formatted or fixed" on screen.
const RUN_DROP = [/^\[SARIF Reporter\]/, /^\[Updated Sources Reporter\]/]
const RUN_MASKS = [
  [/ - \(\d+(?:\.\d+)?s\)/g, ''],
  [/(Successfully copied )[\d.]+[kMG]?B/g, '$1<size>'],
  // The summary's last cell keeps its width: 14 characters before the pipe.
  [/ \d+(?:\.\d+)?s {2,}\|/g, ' <elapsed>    |'],
  [new RegExp(CONTAINER, 'g'), '<container>'],
  [/(megalinter\.io\/)\d+\.\d+\.\d+/g, '$1<version>'],
  [/(\[markdownlint v)[\d.]+\]/g, '$1<version>]']
]

let story = null

After((test) => {
  if (!(test && test.tags && test.tags.includes(TAG))) return
  if (story && story.closeTerminal) story.closeTerminal()
  for (const name of [CONTAINER, `${CONTAINER}-first`]) execSync(`docker rm -f ${name} >/dev/null 2>&1 || true`)
  fs.rmSync(PROJECT, { recursive: true, force: true })
  story = null
})

const git = (args) => execSync(`git ${args}`, { cwd: PROJECT, encoding: 'utf8' })
const read = (file) => fs.readFileSync(path.join(PROJECT, file), 'utf8')

// The findings a MegaLinter run reports, without its durations: the verdict
// of each linter, every rule it flags, and the run's own last word.
function verdict (output) {
  return stripAnsiEscapeSequences(output).split('\n')
    .filter(line => /Linted \[|error MD\d+|Successfully linted/.test(line))
    .map(line => line.replace(/ - \(\d+(?:\.\d+)?s\)/, '').trim())
}

// The fixed files a run handed back, each with what MegaLinter made of it.
function handedBack () {
  const folder = path.join(PROJECT, HANDED_BACK)
  if (!fs.existsSync(folder)) return ''
  return execSync('find . -type f', { cwd: folder, encoding: 'utf8' }).trim().split('\n')
    .map(file => `${file}:\n${fs.readFileSync(path.join(folder, file), 'utf8')}`).join('\n')
}

storyboardStep(Given, 'a generated project holds a status table with emoji, its pipes lined up on screen, and a copy padded by character count', async () => {
  fs.rmSync(PROJECT, { recursive: true, force: true })
  renderProject({}, { dst: PROJECT })
  fs.mkdirSync(path.join(PROJECT, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(PROJECT, ON_SCREEN), ON_SCREEN_BODY)
  fs.writeFileSync(path.join(PROJECT, BY_COUNT), BY_COUNT_BODY)
  fs.appendFileSync(path.join(PROJECT, CONFIG), `\n${MARKDOWN_ONLY.join('\n')}\n`)
  git('init --quiet --initial-branch=main')
  git('config user.email "e2e@test.local" && git config user.name "E2E"')
  git('add -A && git commit --quiet --no-verify -m "docs: add the status tables"')

  story = { env: { ...process.env, TASK_MEGALINTER_CONTAINER_NAME: CONTAINER } }
  delete story.env.TASK_E2E_UPDATE_BASELINES
  story.closeTerminal = await openLocalTerminal(I, { cwd: PROJECT, env: story.env, port: 7711, height: 1200, width: 1440 })
  // tail names each file above its last five lines.
  const screen = await terminalCard(I, 'tables-committed', `tail -n 5 ${CONFIG} ${ON_SCREEN} ${BY_COUNT}`)
  for (const said of [...MARKDOWN_ONLY, `==> ${ON_SCREEN} <==`, '| task | ✅     |', `==> ${BY_COUNT} <==`, '| task | ✅      |']) {
    assert.ok(screen.includes(said), `Expected the settings and both tables on screen, with "${said}":\n${screen}`)
  }
  assert.equal(git('status --porcelain'), '', 'Both tables and the settings are committed')
})

storyboardStep(Then, 'MegaLinter leaves both tables as they are, run after run, and markdownlint flags only the copy padded by character count', async () => {
  // The first run, off camera: whatever it fixes comes back under
  // megalinter-reports/updated_sources, ready to copy over the project.
  const first = await runTask(PROJECT, ['megalinter', `TASK_MEGALINTER_CONTAINER_NAME=${CONTAINER}-first`], { timeout: 600000 })
  const fixed = handedBack()
  assert.equal(fixed, '', `MegaLinter must leave both tables as they are, but its first run handed back:\n${fixed}`)
  assert.ok(first.raw.includes(NOTHING_FIXED), `The first run must say it fixed nothing:\n${first.raw.slice(-4000)}`)
  assert.equal(first.exitCode, 0, `The first run must end like the second one:\n${first.raw.slice(-4000)}`)
  const firstVerdict = verdict(read(LOG))
  assert.ok(firstVerdict.some(line => line.includes('MD060')), `The first run's log must hold markdownlint's findings:\n${firstVerdict.join('\n')}`)

  // The second run, on camera, from markdownlint's own section down.
  await clearTerminal(I)
  await typeCommandAndWait(I, RUN, 600000)
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'second-run-same-verdict', { fromMarker: 'files with [markdownlint]', mask: RUN_MASKS, drop: RUN_DROP }))
  const screen = await terminalScreenText(I)
  for (const said of [`${BY_COUNT}:5:`, `${BY_COUNT}:6:`, 'MD060/table-column-style', NOTHING_FIXED, 'exit code 0']) {
    assert.ok(screen.includes(said), `Expected markdownlint's MD060 on the padded copy, nothing fixed and "exit code 0", with "${said}":\n${screen}`)
  }
  assert.ok(!screen.includes(`${ON_SCREEN}:`), `markdownlint must accept the table lined up on screen:\n${screen}`)
  assert.equal(handedBack(), '', 'The second run must hand nothing back either')
  assert.deepEqual(verdict(read(LOG)), firstVerdict, 'Both runs must reach the same verdict')
  assert.equal(read(ON_SCREEN), ON_SCREEN_BODY)
  assert.equal(read(BY_COUNT), BY_COUNT_BODY)
  assert.equal(git('status --porcelain'), '', 'Neither run may change a file of the project')
})
