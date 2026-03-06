const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { execSync } = require('child_process')

const { executeCopier } = require('../../template/step_objects/commands')

const activeContainers = []
const CONTAINER_WORKDIR = '/workspace'
const CONTAINER_TASKFILE = `${CONTAINER_WORKDIR}/Taskfile.yml`

function runCommand (command, options = {}) {
  return execSync(command, {
    encoding: 'utf8',
    ...options
  })
}

function runCommandWithResult (command, options = {}) {
  try {
    const output = runCommand(command, options)
    return { exitCode: 0, output: output || '' }
  } catch (error) {
    const stdout = error.stdout ? String(error.stdout) : ''
    const stderr = error.stderr ? String(error.stderr) : ''

    return {
      exitCode: typeof error.status === 'number' ? error.status : 1,
      output: `${stdout}${stderr}`
    }
  }
}

function shellEscape (value) {
  const quote = String.fromCharCode(39)
  const escapedQuote = quote + '"' + quote + '"' + quote

  return quote + String(value).replace(/'/g, escapedQuote) + quote
}

function containerName () {
  return `bootstrap-unzip-${crypto.randomBytes(4).toString('hex')}`
}

function normalizeBootstrapCommand (command) {
  const trimmedCommand = command.trim()

  if (trimmedCommand === 'task') {
    return `task --taskfile ${shellEscape(CONTAINER_TASKFILE)}`
  }

  if (trimmedCommand.startsWith('task ')) {
    return `task --taskfile ${shellEscape(CONTAINER_TASKFILE)} ${trimmedCommand.slice(5)}`
  }

  return trimmedCommand
}

function execInContainer (name, command, options = {}) {
  const {
    user,
    workdir,
    env = {}
  } = options

  const userArgs = user ? `-u ${shellEscape(user)}` : ''
  const workdirArgs = workdir ? `-w ${shellEscape(workdir)}` : ''
  const envArgs = Object.entries(env)
    .map(([key, value]) => `-e ${shellEscape(`${key}=${value}`)}`)
    .join(' ')

  return runCommandWithResult(
    `docker exec ${userArgs} ${workdirArgs} ${envArgs} ${shellEscape(name)} sh -lc ${shellEscape(command)}`
  )
}

function removeContainer (name) {
  try {
    runCommand(`docker rm -f ${shellEscape(name)}`)
  } catch (_) {
    // Ignore cleanup failures.
  }
}

Before(function () { // eslint-disable-line no-undef
  this.lastBootstrapResult = null
})

After(function () { // eslint-disable-line no-undef
  if (this.containerName) {
    removeContainer(this.containerName)
    const index = activeContainers.indexOf(this.containerName)

    if (index !== -1) {
      activeContainers.splice(index, 1)
    }
  }

  if (this.generatedProjectDir) {
    fs.rmSync(path.dirname(this.generatedProjectDir), { recursive: true, force: true })
  }
})

Given('a generated toolbox project is mounted in a fresh Ubuntu bootstrap container', function () { // eslint-disable-line no-undef
  const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-unzip-'))
  this.generatedProjectDir = path.join(tempBaseDir, 'generated')
  fs.mkdirSync(this.generatedProjectDir, { recursive: true })

  executeCopier(this.generatedProjectDir)

  const taskBinary = fs.realpathSync(runCommand('command -v task').trim())
  const uid = process.getuid()
  const gid = process.getgid()

  this.containerName = containerName()

  runCommand(
    [
      'docker run -d',
      `--name ${shellEscape(this.containerName)}`,
      `-v ${shellEscape(this.generatedProjectDir)}:${CONTAINER_WORKDIR}`,
      'ubuntu:24.04',
      'sleep infinity'
    ].join(' ')
  )
  activeContainers.push(this.containerName)
  runCommand(`docker cp ${shellEscape(taskBinary)} ${shellEscape(`${this.containerName}:/usr/local/bin/task`)}`)

  const prepareResult = execInContainer(this.containerName, [
    'set -eu',
    'apt-get update -qq',
    'apt-get install -y -qq sudo',
    'chmod 0755 /usr/local/bin/task',
    `BOOTSTRAP_USER="$(getent passwd ${uid} | cut -d: -f1 || true)"`,
    'if [ -z "$BOOTSTRAP_USER" ]; then',
    `  if ! getent group ${gid} >/dev/null 2>&1; then groupadd -g ${gid} bootstrap; fi`,
    `  useradd -m -u ${uid} -g ${gid} -s /bin/sh bootstrap`,
    '  BOOTSTRAP_USER="bootstrap"',
    'fi',
    'printf "%s" "$BOOTSTRAP_USER" > /tmp/bootstrap-user',
    'echo "$BOOTSTRAP_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/bootstrap',
    'chmod 0440 /etc/sudoers.d/bootstrap'
  ].join('\n'))

  if (prepareResult.exitCode !== 0) {
    throw new Error(`Failed to prepare Ubuntu bootstrap container:\n${prepareResult.output}`)
  }

  const userResult = execInContainer(this.containerName, 'cat /tmp/bootstrap-user')
  if (userResult.exitCode !== 0 || !userResult.output.trim()) {
    throw new Error(`Failed to resolve the bootstrap container user:\n${userResult.output}`)
  }

  this.containerUser = userResult.output.trim()

  const workspaceResult = execInContainer(this.containerName, `test -f ${shellEscape(CONTAINER_TASKFILE)}`)
  if (workspaceResult.exitCode !== 0) {
    throw new Error(`Failed to mount the generated toolbox project in ${CONTAINER_WORKDIR}.`)
  }
})

When('I run {string} in the Ubuntu bootstrap container', function (command) { // eslint-disable-line no-undef
  this.lastBootstrapResult = execInContainer(this.containerName, normalizeBootstrapCommand(command), {
    user: this.containerUser,
    workdir: CONTAINER_WORKDIR,
    env: {
      PATH: '/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
    }
  })
})

Then('the bootstrap command should fail', function () { // eslint-disable-line no-undef
  if (!this.lastBootstrapResult || this.lastBootstrapResult.exitCode === 0) {
    throw new Error(`Expected bootstrap command to fail, but it succeeded.\nOutput:\n${this.lastBootstrapResult ? this.lastBootstrapResult.output : ''}`)
  }
})

Then('the bootstrap command should succeed', function () { // eslint-disable-line no-undef
  if (!this.lastBootstrapResult || this.lastBootstrapResult.exitCode !== 0) {
    throw new Error(`Expected bootstrap command to succeed, but it failed.\nOutput:\n${this.lastBootstrapResult ? this.lastBootstrapResult.output : ''}`)
  }
})

Then('the bootstrap command output should contain {string}', function (expected) { // eslint-disable-line no-undef
  if (!this.lastBootstrapResult || !this.lastBootstrapResult.output.includes(expected)) {
    throw new Error(`Expected bootstrap output to contain "${expected}", but got:\n${this.lastBootstrapResult ? this.lastBootstrapResult.output : ''}`)
  }
})

Then('the bootstrap command output should not contain {string}', function (unexpected) { // eslint-disable-line no-undef
  if (this.lastBootstrapResult && this.lastBootstrapResult.output.includes(unexpected)) {
    throw new Error(`Expected bootstrap output not to contain "${unexpected}", but it was found:\n${this.lastBootstrapResult.output}`)
  }
})

Then('{string} should be available in the Ubuntu bootstrap container', function (binaryName) { // eslint-disable-line no-undef
  const result = execInContainer(this.containerName, `command -v ${binaryName}`, {
    user: this.containerUser,
    workdir: CONTAINER_WORKDIR
  })

  if (result.exitCode !== 0) {
    throw new Error(`Expected ${binaryName} to be available in the bootstrap container.\nOutput:\n${result.output}`)
  }
})
