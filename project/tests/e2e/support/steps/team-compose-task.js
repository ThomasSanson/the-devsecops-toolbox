/* global inject Given When Then After */
/**
 * Storyboard for @team-compose-task (features/02-daily-work/team-compose-task.feature).
 *
 * The generated project/Taskfile.yml names the project's Docker Compose command
 * once, in PROJECT_DOCKER_COMPOSE, so a task the team adds runs Compose on
 * project/docker-compose.yml from the root of the project. Proven in a real
 * terminal on a fresh render of the working-branch template.
 */
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { renderProject } = require('../helpers/copierRender')
const { openLocalTerminal } = require('../helpers/localTerminal')
const { terminalCard } = require('../terminal/capture')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const { I } = inject()

// Fixed path: its basename is the project's name, and the prompt shows it.
const PROJECT = '/tmp/acme'
const TASKFILE = 'project/Taskfile.yml'
const VARIABLE = 'vars:\n  PROJECT_DOCKER_COMPOSE: "cd project && docker compose"\n'
const TASK = 'project:deploy:compose:config'
const TEAM_TASK = `
  ${TASK}:
    desc: Show the Docker Compose configuration of the project
    cmds:
      - "{{.PROJECT_DOCKER_COMPOSE}} config"
`

let team = null

After(() => {
  if (!team) return
  if (team.closeTerminal) team.closeTerminal()
  for (const leftover of [PROJECT, `${PROJECT}.gitconfig`]) fs.rmSync(leftover, { recursive: true, force: true })
  team = null
})

// The blob hashes and line numbers of the diff move with any edit of the
// starter Taskfile, never with the task the team adds.
const DIFF_MASKS = [
  [/\bindex [0-9a-f]{7,}\.\.[0-9a-f]{7,}/g, 'index <sha>..<sha>'],
  [/^@@ -[1-9]\d*,(\d+) \+[1-9]\d*,(\d+) @@/g, '@@ -<line>,$1 +<line>,$2 @@']
]

const card = (frame, line, mask = []) => terminalCard(I, frame, line, { mask })
const run = (cmd) => execSync(cmd, { cwd: PROJECT, env: team.env, encoding: 'utf8', stdio: 'pipe' })

storyboardStep(Given, "a new project's Taskfile names its Docker Compose command at the top", async () => {
  fs.rmSync(PROJECT, { recursive: true, force: true })
  renderProject({}, { dst: PROJECT })
  const gitConfig = `${PROJECT}.gitconfig`
  fs.writeFileSync(gitConfig, '[safe]\n\tdirectory = *\n[user]\n\temail = e2e@test.local\n\tname = e2e\n[init]\n\tdefaultBranch = main\n')
  team = { env: { ...process.env, GIT_CONFIG_GLOBAL: gitConfig } }
  for (const name of ['TASK_E2E_UPDATE_BASELINES', 'TASK_CODECEPTJS_GREP', 'TASK_CODECEPTJS_FEATURES', 'CI']) delete team.env[name]
  run('git init -q && git add -A && git commit -qm "the generated project"')

  team.closeTerminal = await openLocalTerminal(I, { cwd: PROJECT, env: team.env, port: 7709, height: 800 })
  const screen = await card('compose-command-at-the-top', `head -n 5 ${TASKFILE}`)
  assert.ok(screen.includes('PROJECT_DOCKER_COMPOSE: "cd project && docker compose"'), `Expected the variable on screen:\n${screen}`)
  // Twin: the variable sits at the top of the file, before the first task.
  const taskfile = fs.readFileSync(path.join(PROJECT, TASKFILE), 'utf8')
  assert.ok(taskfile.includes(VARIABLE), `Expected ${TASKFILE} to define PROJECT_DOCKER_COMPOSE:\n${taskfile}`)
  assert.ok(taskfile.indexOf(VARIABLE) < taskfile.indexOf('tasks:'), `Expected PROJECT_DOCKER_COMPOSE before the tasks in ${TASKFILE}`)
})

storyboardStep(When, 'the team adds a task of its own that calls PROJECT_DOCKER_COMPOSE', async () => {
  fs.appendFileSync(path.join(PROJECT, TASKFILE), TEAM_TASK)
  const screen = await card('team-adds-a-compose-task', 'git diff', DIFF_MASKS)
  assert.ok(screen.includes(`+  ${TASK}:`) && screen.includes('+      - "{{.PROJECT_DOCKER_COMPOSE}} config"'), `Expected the new task in the diff:\n${screen}`)
  assert.deepEqual(run('git diff --name-only').trim().split('\n'), [TASKFILE], 'The team changed its Taskfile and nothing else')
})

storyboardStep(Then, "the team's task runs Docker Compose on the project's own compose file", async () => {
  const screen = await card('team-task-runs-compose', `task ${TASK}; echo "exit code: $?"`)
  for (const said of [`task: [${TASK}] cd project && docker compose config`, 'name: acme', 'exit code: 0']) {
    assert.ok(screen.includes(said), `Expected "${said}" on screen:\n${screen}`)
  }
  // Twin: the same task, off camera, exits 0 (execSync throws otherwise) on
  // the configuration of the project's own compose file.
  assert.match(run(`task ${TASK}`), /^name: acme$/m)
})
