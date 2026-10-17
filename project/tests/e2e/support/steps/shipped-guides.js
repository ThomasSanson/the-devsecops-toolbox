/* global inject Given Then After */
/**
 * Storyboard of features/01-install/shipped-guides.feature: the toolbox's map
 * of its own source tree, docs/guidelines/Task Mapping.md, stays in the
 * toolbox. One real terminal in THIS container (helpers/localTerminal.js)
 * types the same line in the toolbox (/workspace), then in a fresh render of
 * it (helpers/copierRender.js), so the two cards show the same folder.
 *
 * ONE Gherkin sentence = ONE card = ONE pixel baseline, asserted inside the
 * step (tolerance: 0); each card is twinned with the same fact on disk.
 */
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const { TEMPLATE_SRC, renderProject, removeRendered } = require('../helpers/copierRender')
const { openLocalTerminal } = require('../helpers/localTerminal')
const { terminalCard, typeCommandAndWait } = require('../terminal/capture')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const { I } = inject()

const GUIDES = 'docs/guidelines'
const TASK_MAP = 'Task Mapping.md'
// The same line on both cards: the folder, then the top of the task map.
const LOOK = `ls ${GUIDES} && head -n 5 "${GUIDES}/${TASK_MAP}"`
// Fixed path, not a mkdtemp: the prompt prints it.
const PROJECT = '/tmp/e2e-shipped-guides'

let closeTerminal = null

After((test) => {
  if (!(test && test.tags && test.tags.includes('@shipped-guides'))) return
  if (closeTerminal) closeTerminal()
  closeTerminal = null
  removeRendered(PROJECT)
})

storyboardStep(Given, "the toolbox's guides folder holds a task map of the toolbox itself", async () => {
  closeTerminal = await openLocalTerminal(I, { cwd: TEMPLATE_SRC, env: process.env, port: 7713, height: 600 })
  const screen = await terminalCard(I, 'toolbox-guides', LOOK)
  for (const said of [`'${TASK_MAP}'`, 'Task Mapping - The DevSecOps Toolbox', 'Copier Template for DevSecOps pipeline scaffolding']) {
    assert.ok(screen.includes(said), `Expected the toolbox's guides and its task map on screen, with "${said}":\n${screen}`)
  }
  assert.ok(fs.existsSync(path.join(TEMPLATE_SRC, GUIDES, TASK_MAP)), `The toolbox must hold ${GUIDES}/${TASK_MAP}`)
})

storyboardStep(Then, 'a project generated with every default answer gets the other guides and no task map', async () => {
  removeRendered(PROJECT)
  renderProject({}, { dst: PROJECT })
  // Off camera: the card below clears the screen before it types.
  await typeCommandAndWait(I, `cd ${PROJECT}`)
  const screen = await terminalCard(I, 'generated-project-guides', LOOK)
  assert.ok(screen.includes(`head: cannot open '${GUIDES}/${TASK_MAP}' for reading: No such file or directory`),
    `Expected head to find no task map in the generated project:\n${screen}`)
  const others = fs.readdirSync(path.join(TEMPLATE_SRC, GUIDES)).filter(name => name !== TASK_MAP).sort()
  assert.deepEqual(fs.readdirSync(path.join(PROJECT, GUIDES)).sort(), others,
    `A generated project gets every guide of the toolbox but ${TASK_MAP}`)
})
