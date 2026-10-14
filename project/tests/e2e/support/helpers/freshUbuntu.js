/**
 * A fresh Ubuntu container holding a copy of the toolbox repo itself (the
 * template is self-hosting: the source repo IS a valid generated project), with
 * a live ttyd terminal rooted in it. The first-run-help story drives that
 * terminal as the developer would, so gum and glow draw their real boxes and
 * questions; runInFreshUbuntu runs the same checks off camera for the twins.
 */
const fs = require('fs')
const path = require('path')
const {
  shellEscape,
  runCommand,
  runCommandWithResult,
  containerName,
  execInContainer,
  execInContainerAsUser,
  removeContainer,
  waitForTtyd
} = require('./docker')

const CONTAINER_WORKDIR = '/workspace'
const CONTAINER_USER = 'bootstrap'
const SETUP_TIMEOUT = 300000
const TTYD_READY_TIMEOUT = 30000

/**
 * Resolve the repo root accessible to the codeceptjs container.
 *
 * In the dockerised runner the full repo is tarred into `/workspace`
 * by project:test:e2e before codeceptjs starts. Local runs fall back
 * to a path relative to this file.
 */
function repoRoot () {
  return fs.existsSync('/workspace/project/docker-compose.yml')
    ? '/workspace'
    : path.resolve(__dirname, '..', '..', '..', '..', '..')
}

/**
 * Spawn a fresh Ubuntu container preloaded with the repo and the `task`
 * binary (git and unzip are baked into the image), commit the repo with
 * `gitRemote` as its origin, and serve a bash session in it through ttyd.
 *
 * Returns the container name (caller is responsible for cleanup via
 * teardownFreshUbuntu).
 */
function setupFreshUbuntuTerminal ({ gitRemote }) {
  const root = repoRoot()
  const name = containerName()
  const taskBinary = fs.realpathSync(runCommand('command -v task').trim())

  runCommand(
    `cd ${shellEscape(root)}/project && docker compose run -d --name ${shellEscape(name)} ubuntu`,
    { timeout: SETUP_TIMEOUT }
  )

  runCommand(`docker cp ${shellEscape(taskBinary)} ${shellEscape(`${name}:/usr/local/bin/task`)}`)

  // Copy the whole repo as the project context. The toolbox template is
  // self-hosting: the source repo IS a valid generated project, so we
  // skip the `task copier` round-trip used by the legacy bootstrap suite.
  runCommand(`docker cp ${shellEscape(`${root}/.`)} ${shellEscape(`${name}:${CONTAINER_WORKDIR}`)}`)

  const prepareResult = execInContainer(name, [
    'set -eu',
    `chown -R ${CONTAINER_USER}:${CONTAINER_USER} ${CONTAINER_WORKDIR}`,
    'chmod 0755 /usr/local/bin/task'
  ].join('\n'), { user: 'root' })
  if (prepareResult.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to prepare fresh Ubuntu container:\n${prepareResult.output}`)
  }

  const gitResult = execInContainer(name, [
    'set -eu',
    `cd ${CONTAINER_WORKDIR}`,
    `git config --global --add safe.directory ${CONTAINER_WORKDIR}`,
    'git config --global user.email "bootstrap@example.com"',
    'git config --global user.name "Bootstrap"',
    'rm -rf .git',
    'git init -q',
    'git add .',
    'git commit -q -m "bootstrap init"',
    `git remote add origin ${gitRemote}`
  ].join('\n'), { user: CONTAINER_USER })
  if (gitResult.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to set up git remote:\n${gitResult.output}`)
  }

  // Same launch line as the journey containers (journeyContainer.js).
  const ttydStart = execInContainerAsUser(name, CONTAINER_USER, [
    `cd ${CONTAINER_WORKDIR} && nohup ttyd -p 7681 -W -t scrollback=5000 -t rendererType=dom bash >/tmp/ttyd.log 2>&1 &`,
    'sleep 1'
  ].join('\n'))
  if (ttydStart.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to start ttyd:\n${ttydStart.output}`)
  }
  waitForTtyd(name, TTYD_READY_TIMEOUT)

  return name
}

/**
 * Run a command in the container as the bootstrap user, off camera and
 * without a terminal, and capture its combined stdout+stderr. Returns
 * { output, exitCode }. The wrapper exports PATH so the user-local binaries
 * the story installed (`~/.local/bin/glab`) are found, as in the terminal.
 */
function runInFreshUbuntu (name, command, { timeout = SETUP_TIMEOUT } = {}) {
  const wrapped = [
    'set +e',
    'export PATH="$HOME/.local/bin:$PATH"',
    `cd ${CONTAINER_WORKDIR}`,
    command
  ].join('\n')

  const result = runCommandWithResult(
    `docker exec -u ${shellEscape(CONTAINER_USER)} ${shellEscape(name)} sh -c ${shellEscape(wrapped)}`,
    { timeout }
  )
  return { output: result.output || '', exitCode: result.exitCode }
}

/**
 * Cleanup hook — safe to call multiple times.
 */
function teardownFreshUbuntu (name) {
  if (!name) return
  removeContainer(name)
}

module.exports = {
  setupFreshUbuntuTerminal,
  runInFreshUbuntu,
  teardownFreshUbuntu
}
