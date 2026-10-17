/* global inject Given When After */
/**
 * Storyboard of features/01-install/missing-docker.feature: on a machine
 * without Docker, the installer says so and names what to install before it
 * sets up the project, then goes on.
 *
 * ONE throwaway container of the compose `ubuntu` image (curl and git, no
 * Docker, no Podman), the working-branch installer and its template staged at
 * the journey paths, the toolchain installed beforehand by install.sh's own
 * functions, and ONE live terminal in an empty project folder.
 * ONE Gherkin sentence = ONE card = ONE pixel baseline, asserted inside the
 * step (tolerance: 0), twinned with a check of the same fact: the machine, the
 * screen text and the installer's log.
 */
const assert = require('assert/strict')
const { execFileSync } = require('child_process')
const {
  shellEscape,
  runCommand,
  containerName,
  execInContainer,
  execInContainerAsUser,
  removeContainer,
  stripAnsiEscapeSequences,
  waitForTtyd
} = require('../helpers/docker')
const {
  CONTAINER_WORKDIR,
  PROJECT_DIR,
  INSTALL_LOG,
  WRAPPER_PATH,
  prepareWorkingBranchInstaller,
  preinstallToolchain
} = require('../helpers/journeyContainer')
const {
  COMMAND_TIMEOUT_MS,
  openTerminal,
  clearTerminal,
  terminalCard,
  waitForTerminalText,
  waitForTerminalSettle,
  captureTerminalFrame,
  terminalScreenText
} = require('../terminal/capture')
const { storyboardStep, addStoryboardFrame } = require('../../../../../.config/codeceptjs/storyboard')

const { I } = inject()

const LAUNCH = `bash ${WRAPPER_PATH}`
const SCOPE_PROMPT = 'Install the complete DevSecOps framework?'
const FIRST_QUESTION = 'Do you need Ansible?'
const WARNING = 'Docker does not answer on this machine: it is missing, or not running.'
const WHY = 'task code, task build and task test run their tools in containers.'
const WHERE = 'https://docs.docker.com/engine/install/'
const SETTING_UP = '📋 Setting up project...'

let machine = null

After(() => {
  if (machine) removeContainer(machine)
  machine = null
})

function onMachine (script) {
  return execInContainerAsUser(machine, 'bootstrap', script)
}

// Off camera: the machine, an empty project folder, the staged installer, the
// toolchain it would otherwise download, and a terminal in the folder.
function setupMachineWithoutDocker () {
  const name = containerName()
  runCommand(`cd ${CONTAINER_WORKDIR}/project && docker compose run -d --name ${shellEscape(name)} ubuntu`, { timeout: 300000 })
  const folder = execInContainer(name, `install -d -o bootstrap -g bootstrap ${PROJECT_DIR}`, { user: 'root' })
  if (folder.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to create the project folder:\n${folder.output}`)
  }
  prepareWorkingBranchInstaller(name)
  preinstallToolchain(name)
  const ttyd = execInContainerAsUser(name, 'bootstrap', [
    `cd ${PROJECT_DIR} && nohup ttyd -p 7681 -W -t scrollback=5000 -t rendererType=dom bash >/tmp/ttyd.log 2>&1 &`,
    'sleep 1'
  ].join('\n'))
  if (ttyd.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to start ttyd:\n${ttyd.output}`)
  }
  waitForTtyd(name, 30000)
  return name
}

storyboardStep(Given, "a developer's machine has neither Docker nor Podman", async () => {
  machine = setupMachineWithoutDocker()
  await openTerminal(I, machine, { width: 1440, height: 1400 })
  const screen = await terminalCard(I, 'no-container-engine', 'type docker podman')
  for (const said of ['bash: type: docker: not found', 'bash: type: podman: not found']) {
    assert.ok(screen.includes(said), `Expected the machine card to show "${said}":\n${screen}`)
  }
  assert.notEqual(onMachine('command -v docker || command -v podman').exitCode, 0, 'The machine must have neither docker nor podman')
})

// Enter on the typed line, y on the scope menu (gum erases it once answered),
// and the card is taken while Copier's first question waits for its answer.
storyboardStep(When, 'the developer starts the installer, it warns that Docker is missing, says where to get it, and goes on to the setup questions', async () => {
  await clearTerminal(I)
  I.type(LAUNCH)
  I.pressKey('Enter')
  await waitForTerminalText(I, SCOPE_PROMPT, COMMAND_TIMEOUT_MS)
  await waitForTerminalSettle(I)
  I.pressKey('y')
  await waitForTerminalText(I, FIRST_QUESTION, COMMAND_TIMEOUT_MS)
  await waitForTerminalSettle(I)
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'installer-warns-no-docker', { fromMarker: LAUNCH }))

  // The warning, then the setup it does not stop: in that order on the screen
  // and in the installer's log.
  const order = [WARNING, WHY, WHERE, SETTING_UP, FIRST_QUESTION]
  for (const [text, where] of [[await terminalScreenText(I), 'screen'], [stripAnsiEscapeSequences(onMachine(`cat ${INSTALL_LOG}`).output || ''), 'install log']]) {
    const at = order.map(said => text.indexOf(said))
    assert.ok(at.every((index, i) => index !== -1 && (i === 0 || index > at[i - 1])),
      `Expected the ${where} to show, in order, ${JSON.stringify(order)}:\n${text}`)
  }

  // The other half: where Docker answers, as in this test container, the same
  // check of the same installer says nothing.
  const quiet = execFileSync('sh', ['-c', `grep -v '^main "' ${CONTAINER_WORKDIR}/.config/devsecops/install.sh > /tmp/missing-docker-lib.sh && . /tmp/missing-docker-lib.sh && docker info >/dev/null && check_container_engine`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.equal(quiet, '', `Where Docker answers, the installer must not warn:\n${quiet}`)
})
