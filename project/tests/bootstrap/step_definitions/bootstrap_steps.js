const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { execSync } = require('child_process')

const { executeCopier } = require('../../template/step_objects/commands')

const activeContainers = []
const CONTAINER_WORKDIR = '/workspace'
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

const DISTRO_IMAGES = {
  ubuntu: 'ubuntu:24.04',
  alpine: 'alpine:3.20',
  fedora: 'fedora:41'
}

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
  return `bootstrap-wf-${crypto.randomBytes(4).toString('hex')}`
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

function prepareDistroContainer (scenario, distro, options = {}) {
  const { withSudo = true } = options
  const image = DISTRO_IMAGES[distro] || `${distro}:latest`

  const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-wf-'))
  scenario.generatedProjectDir = path.join(tempBaseDir, 'generated')
  fs.mkdirSync(scenario.generatedProjectDir, { recursive: true })

  executeCopier(scenario.generatedProjectDir)

  scenario.containerName = containerName()
  scenario.containerDistro = distro

  runCommand(
    [
      'docker run -d',
      `--name ${shellEscape(scenario.containerName)}`,
      shellEscape(image),
      'sleep infinity'
    ].join(' ')
  )
  activeContainers.push(scenario.containerName)

  const workspacePrepareResult = execInContainer(scenario.containerName, `mkdir -p ${shellEscape(CONTAINER_WORKDIR)}`)
  if (workspacePrepareResult.exitCode !== 0) {
    throw new Error(`Failed to create ${CONTAINER_WORKDIR} in the bootstrap container:\n${workspacePrepareResult.output}`)
  }

  runCommand(`docker cp ${shellEscape(`${scenario.generatedProjectDir}/.`)} ${shellEscape(`${scenario.containerName}:${CONTAINER_WORKDIR}`)}`)

  if (withSudo) {
    let installSudoCmd
    if (distro === 'alpine') {
      installSudoCmd = 'apk add --no-cache sudo bash curl'
    } else if (distro === 'fedora') {
      installSudoCmd = 'dnf install -y -q sudo curl'
    } else {
      installSudoCmd = 'apt-get update -qq && apt-get install -y -qq sudo curl'
    }

    const prepareResult = execInContainer(scenario.containerName, [
      'set -eu',
      installSudoCmd,
      'if ! id bootstrap >/dev/null 2>&1; then',
      distro === 'alpine'
        ? '  adduser -D -s /bin/sh bootstrap'
        : '  useradd -m -s /bin/sh bootstrap',
      'fi',
      'echo "bootstrap ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/bootstrap',
      'chmod 0440 /etc/sudoers.d/bootstrap'
    ].join('\n'))

    if (prepareResult.exitCode !== 0) {
      throw new Error(`Failed to prepare bootstrap container:\n${prepareResult.output}`)
    }
  }

  scenario.containerUser = 'bootstrap'
}

After(function () { // eslint-disable-line no-undef
  if (this.containerName && this.containerDistro) {
    removeContainer(this.containerName)
    const index = activeContainers.indexOf(this.containerName)

    if (index !== -1) {
      activeContainers.splice(index, 1)
    }
  }

  if (this.generatedProjectDir && this.containerDistro) {
    fs.rmSync(path.dirname(this.generatedProjectDir), { recursive: true, force: true })
  }
})

Given('a generated toolbox project is mounted in a fresh {string} bootstrap container', function (distro) { // eslint-disable-line no-undef
  prepareDistroContainer(this, distro)
})

Given('a generated toolbox project is mounted in a fresh Ubuntu bootstrap container without sudo', function () { // eslint-disable-line no-undef
  prepareDistroContainer(this, 'ubuntu', { withSudo: false })

  const prepareResult = execInContainer(this.containerName, [
    'set -eu',
    'apt-get update -qq && apt-get install -y -qq curl',
    'if ! id bootstrap >/dev/null 2>&1; then',
    '  useradd -m -s /bin/sh bootstrap',
    'fi'
  ].join('\n'))

  if (prepareResult.exitCode !== 0) {
    throw new Error(`Failed to prepare no-sudo bootstrap container:\n${prepareResult.output}`)
  }

  this.containerUser = 'bootstrap'
})

When('I run {string} in the Ubuntu bootstrap container with user {string}', function (command, user) { // eslint-disable-line no-undef
  this.lastBootstrapResult = execInContainer(this.containerName, command, {
    user: user,
    workdir: CONTAINER_WORKDIR,
    env: {
      PATH: '/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      HOME: user === 'root' ? '/root' : `/home/${user}`
    }
  })
})

When('I run {string} in the bootstrap container', function (command) { // eslint-disable-line no-undef
  this.lastBootstrapResult = execInContainer(this.containerName, command, {
    user: this.containerUser,
    workdir: CONTAINER_WORKDIR,
    env: {
      PATH: '/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      HOME: `/home/${this.containerUser}`
    }
  })
})

Given('the {string} file in the repository root', function (filePath) { // eslint-disable-line no-undef
  const fullPath = path.join(REPO_ROOT, filePath)

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Expected file "${filePath}" to exist at "${fullPath}", but it was not found.`)
  }

  this.currentFileContent = fs.readFileSync(fullPath, 'utf8')
  this.currentFilePath = filePath
})

Then('it should contain the pattern {string}', function (pattern) { // eslint-disable-line no-undef
  if (!this.currentFileContent || !this.currentFileContent.includes(pattern)) {
    throw new Error(`Expected "${this.currentFilePath}" to contain pattern "${pattern}", but it was not found.`)
  }
})

Then('it should not contain the pattern {string}', function (pattern) { // eslint-disable-line no-undef
  if (this.currentFileContent && this.currentFileContent.includes(pattern)) {
    throw new Error(`Expected "${this.currentFilePath}" not to contain pattern "${pattern}", but it was found.`)
  }
})
