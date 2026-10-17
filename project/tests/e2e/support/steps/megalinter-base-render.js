/* global inject Given Then After */
// @megalinter-base-render (#152): the MegaLinter base settings a project
// receives are already in the shape Prettier, MegaLinter's YAML formatter,
// keeps them, so `task code` never rewrites that "DO NOT EDIT" file. The same
// command runs on camera in the toolbox, then in a freshly generated project;
// each card is twinned with the same lines read by code.
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const { renderProject } = require('../helpers/copierRender')
const { openLocalTerminal } = require('../helpers/localTerminal')
const { terminalCard, typeCommandAndWait } = require('../terminal/capture')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const { I } = inject()

const TOOLBOX = '/workspace'
const PROJECT = '/tmp/fresh-project'
const BASE_CONFIG = '.config/megalinter/config.base.yml'
const SHOW_LINES = `sed -n '/^REPOSITORY_DUSTILOCK_ARGUMENTS:/,/^SHOW_ELAPSED_TIME:/p' ${BASE_CONFIG} | cat -n`
const LAST_LINE = 'SHOW_ELAPSED_TIME: true'

let story = null

After(test => {
  if (!(test && test.tags && test.tags.includes('@megalinter-base-render'))) return
  if (story && story.closeTerminal) story.closeTerminal()
  fs.rmSync(PROJECT, { recursive: true, force: true })
  story = null
})

// The whole file, and the lines the card shows: from the Dustilock arguments
// down to SHOW_ELAPSED_TIME.
function readBaseConfig (dir) {
  const text = fs.readFileSync(path.join(dir, BASE_CONFIG), 'utf8')
  const shown = text.match(/^REPOSITORY_DUSTILOCK_ARGUMENTS:\n[\s\S]*?^SHOW_ELAPSED_TIME:.*\n/m)
  assert.ok(shown, `${dir}/${BASE_CONFIG} has no lines from REPOSITORY_DUSTILOCK_ARGUMENTS down to SHOW_ELAPSED_TIME`)
  return { text, shown: shown[0] }
}

function assertNoDoubleBlankLine ({ text }, what) {
  const at = text.indexOf('\n\n\n')
  assert.equal(at, -1, `${what} has two blank lines in a row at line ${text.slice(0, at).split('\n').length + 1}`)
}

storyboardStep(Given, "the toolbox's own MegaLinter base settings keep one blank line before SHOW_ELAPSED_TIME", async () => {
  const toolbox = readBaseConfig(TOOLBOX)
  assertNoDoubleBlankLine(toolbox, `The toolbox's ${BASE_CONFIG}`)
  assert.ok(toolbox.shown.endsWith(`\n\n${LAST_LINE}\n`), `Expected one blank line before ${LAST_LINE}:\n${toolbox.shown}`)
  story = { toolbox }
  story.closeTerminal = await openLocalTerminal(I, { cwd: TOOLBOX, env: process.env, port: 7714, height: 600 })
  const screen = await terminalCard(I, 'toolbox-lines', SHOW_LINES)
  assert.ok(screen.includes(LAST_LINE), `Expected the terminal to show ${LAST_LINE}:\n${screen}`)
})

storyboardStep(Then, 'a freshly generated project gets the same lines, with the same single blank line', async () => {
  fs.rmSync(PROJECT, { recursive: true, force: true })
  renderProject({}, { dst: PROJECT })
  const project = readBaseConfig(PROJECT)
  assert.equal(project.shown, story.toolbox.shown, `The generated ${BASE_CONFIG} must carry these lines exactly as the toolbox does`)
  assertNoDoubleBlankLine(project, `The generated ${BASE_CONFIG}`)
  await typeCommandAndWait(I, `cd ${PROJECT}`)
  const screen = await terminalCard(I, 'generated-lines', SHOW_LINES)
  assert.ok(screen.includes(LAST_LINE), `Expected the terminal to show ${LAST_LINE}:\n${screen}`)
})
