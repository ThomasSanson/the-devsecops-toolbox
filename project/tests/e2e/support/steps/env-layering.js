/* global inject After Given When Then */
/**
 * Storyboard of features/02-daily-work/env-layering.feature: a freshly
 * generated project (the working-branch template, rendered with every default
 * answer, helpers/copierRender.js) in a real terminal of this container
 * (helpers/localTerminal.js), and the value `task` really resolves from .env,
 * .env.dev and .env.dist.
 *
 * ONE Gherkin sentence = ONE card = ONE pixel baseline, asserted inside the step
 * (tolerance: 0); every card is twinned with a check of the same fact.
 */
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { renderProject, removeRendered } = require('../helpers/copierRender')
const { openLocalTerminal } = require('../helpers/localTerminal')
const { terminalCard } = require('../terminal/capture')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const { I } = inject()

// Fixed path: it shows in the prompt of every card.
const PROJECT = '/tmp/e2e-env-layering'
// Outside the project, so git status never lists it.
const GIT_CONFIG = `${PROJECT}.gitconfig`
const GUIDE = 'docs/guidelines/Task Mapping.md'
const SHOW = 'task project:monitor:app:info'
// The task the developer adds, written like every other task of that file.
const TASK = `
  project:monitor:app:info:
    desc: Print where the app runs
    cmds:
      - cmd: echo "The app runs at {{.TASK_APP_URL}}"
        silent: true
`
// Blob ids and hunk positions move with any unrelated edit of the template's
// files; what the developer adds does not.
const DIFF_MASKS = [
  [/\bindex [0-9a-f]{7,}\.\.[0-9a-f]{7,}/g, 'index <sha>..<sha>'],
  [/^@@ -[1-9]\d*,(\d+) \+[1-9]\d*,(\d+) @@/g, '@@ -<line>,$1 +<line>,$2 @@']
]

let story = null
const env = () => ({ ...process.env, GIT_CONFIG_GLOBAL: GIT_CONFIG })
const sh = (cmd) => execSync(cmd, { cwd: PROJECT, env: env(), encoding: 'utf8' })
const shows = (screen, said) => assert.ok(screen.includes(said), `Expected the card to show ${JSON.stringify(said)}:\n${screen}`)

After(async (test) => {
  if (!(test && test.tags && test.tags.includes('@env-layering'))) return
  if (story && story.closeTerminal) story.closeTerminal()
  removeRendered(PROJECT)
  fs.rmSync(GIT_CONFIG, { force: true })
  story = null
})

storyboardStep(Given, "the project's guide lists its three settings files in the order task reads them", async () => {
  removeRendered(PROJECT)
  renderProject({}, { dst: PROJECT })
  fs.writeFileSync(GIT_CONFIG, '[safe]\n\tdirectory = *\n[user]\n\temail = e2e@test.local\n\tname = e2e\n[init]\n\tdefaultBranch = main\n')
  sh('git init -q && git add -A && git commit -qm "the generated project"')
  story = { closeTerminal: await openLocalTerminal(I, { cwd: PROJECT, env: env(), port: 7700, height: 900 }) }

  const screen = await terminalCard(I, 'the-guide-names-the-files', `grep -A 9 "Loading Order" "${GUIDE}"`)
  const guide = fs.readFileSync(path.join(PROJECT, GUIDE), 'utf8')
  for (const said of [
    '1. .env       real values and secrets of a deployed environment, never versioned',
    '2. .env.dev   development values, versioned, ready to use',
    '3. .env.dist  defaults for every environment, versioned, no secrets',
    'For local work, edit .env.dev: there is nothing to copy.'
  ]) {
    assert.ok(guide.includes(said), `Expected ${GUIDE} to say ${JSON.stringify(said)}`)
    shows(screen, said)
  }
})

storyboardStep(When, 'the developer adds a setting with a default in .env.dist and a development value in .env.dev, task uses the development value', async () => {
  fs.appendFileSync(path.join(PROJECT, '.env.dist'), 'TASK_APP_URL=https://app.example.com\n')
  fs.appendFileSync(path.join(PROJECT, '.env.dev'), 'TASK_APP_URL=http://localhost:8080\n') // DevSkim: ignore DS162092 -- An example development address in a test project; nothing serves it.
  fs.appendFileSync(path.join(PROJECT, 'project/Taskfile.yml'), TASK)
  assert.deepEqual(sh('git diff --name-only').trim().split('\n'), ['.env.dev', '.env.dist', 'project/Taskfile.yml'],
    'The developer touched the two settings files and the project Taskfile, nothing else')
  assert.equal(sh(SHOW).trim(), 'The app runs at http://localhost:8080') // DevSkim: ignore DS162092 -- An example development address in a test project; nothing serves it.

  const screen = await terminalCard(I, 'env-dev-wins', `git diff && ${SHOW}`, { mask: DIFF_MASKS })
  for (const said of ['+TASK_APP_URL=https://app.example.com', '+TASK_APP_URL=http://localhost:8080', // DevSkim: ignore DS162092 -- An example development address in a test project; nothing serves it.
    '+  project:monitor:app:info:', 'The app runs at http://localhost:8080']) shows(screen, said) // DevSkim: ignore DS162092 -- An example development address in a test project; nothing serves it.
})

storyboardStep(Then, 'a .env file, which git ignores, wins over both', async () => {
  const screen = await terminalCard(I, 'env-wins',
    `echo "TASK_APP_URL=https://staging.example.com" > .env && git status --short --ignored && grep TASK_APP_URL .env .env.dev .env.dist && ${SHOW}`)
  // Throws when git does not ignore the file.
  sh('git check-ignore -q .env')
  assert.equal(sh(SHOW).trim(), 'The app runs at https://staging.example.com')
  for (const said of ['!! .env', '.env:TASK_APP_URL=https://staging.example.com', '.env.dev:TASK_APP_URL=http://localhost:8080', // DevSkim: ignore DS162092 -- An example development address in a test project; nothing serves it.
    '.env.dist:TASK_APP_URL=https://app.example.com', 'The app runs at https://staging.example.com']) shows(screen, said)
})
