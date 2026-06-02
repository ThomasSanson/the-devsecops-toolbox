/**
 * Helper to spawn a fresh Ubuntu container with the toolbox repo mounted
 * inside, without starting ttyd. Used by guidance / pre-flight scenarios
 * where we only need to run `task <something>` and capture stdout (the
 * output is then rendered as a <pre> block in the browser for visual
 * regression — same pattern as init-baseline.js).
 *
 * Why no ttyd? The challenger audit recommended against the ttyd+xterm
 * round-trip for output-only scenarios: it doubles wall-clock per test
 * and introduces a flaky-by-design prompt-detection loop. For scenarios
 * that don't depend on TUI rendering (gum/glow) we capture the command
 * output directly and skip the browser terminal entirely.
 */
const fs = require('fs')
const path = require('path')
const {
  shellEscape,
  runCommand,
  runCommandWithResult,
  containerName,
  execInContainer,
  removeContainer
} = require('./docker')

const CONTAINER_WORKDIR = '/workspace'
const CONTAINER_USER = 'bootstrap'
const SETUP_TIMEOUT = 300000

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
 * binary, with optional extra packages and an optional git remote.
 *
 * Returns the container name (caller is responsible for cleanup via
 * teardownFreshUbuntu / removeContainer).
 */
function setupFreshUbuntuEnvironment ({ extraPackages = [], gitRemote } = {}) {
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

  const prepareCommands = ['set -eu']
  if (extraPackages.length > 0) {
    prepareCommands.push(
      'apt-get update -qq',
      `apt-get install -y -qq ${extraPackages.join(' ')}`
    )
  }
  prepareCommands.push(
    `chown -R ${CONTAINER_USER}:${CONTAINER_USER} ${CONTAINER_WORKDIR}`,
    'chmod 0755 /usr/local/bin/task'
  )

  const prepareResult = execInContainer(name, prepareCommands.join('\n'), { user: 'root' })
  if (prepareResult.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to prepare fresh Ubuntu container:\n${prepareResult.output}`)
  }

  if (gitRemote) {
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
  }

  return name
}

/**
 * Run a command inside the fresh Ubuntu environment as the bootstrap
 * user and capture its combined stdout+stderr. Returns { output, exitCode }.
 *
 * The shell wrapper exports PATH so that user-local binaries installed
 * by `task dev:setup-environment` (e.g. `~/.local/bin/glab`) are picked
 * up, mirroring the real user experience. The bootstrap helper's
 * `execInContainer` does not propagate timeouts, so we go through
 * `runCommandWithResult` directly here — `task devsecops:init` can take
 * several minutes on a fresh container.
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
  CONTAINER_WORKDIR,
  setupFreshUbuntuEnvironment,
  runInFreshUbuntu,
  teardownFreshUbuntu
}
