const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { execSync } = require('child_process')

const { I } = global.inject()
const { executeCopier } = require('../../template/step_objects/commands')

const CONTAINER_WORKDIR = '/workspace'
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const TTYD_READY_TIMEOUT = 30000
const TERMINAL_CMD_TIMEOUT = 300000
const INSTALL_SCRIPT_TIMEOUT = 900000
const GITLAB_STACK_TIMEOUT = 900000
const GITLAB_DOCKER_NETWORK_ALIAS = 'the-devsecops-toolbox'
const DEFAULT_INSTALL_ANSWERS_COUNT = 40
const DOCKER_SCENARIO_USER = 'bootstrap'

function dockerHost () {
  const dh = process.env.DOCKER_HOST || ''
  const match = dh.match(/tcp:\/\/([^:]+)/)
  return match ? match[1] : '127.0.0.1'
}

const activeContainers = []

function runCommand (command, options = {}) {
  return execSync(command, {
    encoding: 'utf8',
    timeout: 120000,
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

function runHostCommandInScenario (scenario, command, options = {}) {
  const result = runCommandWithResult(command, {
    timeout: TERMINAL_CMD_TIMEOUT,
    ...options
  })
  scenario.lastCommandOutput = result.output
  scenario.lastCommandExitCode = result.exitCode
  scenario.dockerOutput += result.output

  return result
}

function parseJson (raw, context) {
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`Failed to parse JSON for ${context}:\n${raw}`)
  }
}

function buildCurlCommand ({ method = 'GET', url, headers = [], dataUrlencoded = [], jsonBody }) {
  const parts = ['curl', '-sS', '--fail', '--request', method]

  headers.forEach(function (header) {
    parts.push('--header', shellEscape(header))
  })

  dataUrlencoded.forEach(function (value) {
    parts.push('--data-urlencode', shellEscape(value))
  })

  if (typeof jsonBody !== 'undefined') {
    parts.push('--header', shellEscape('Content-Type: application/json'))
    parts.push('--data', shellEscape(JSON.stringify(jsonBody)))
  }

  parts.push(shellEscape(url))

  return parts.join(' ')
}

function runCurlJson (request, context) {
  const result = runCommandWithResult(buildCurlCommand(request), { timeout: 180000 })
  if (result.exitCode !== 0) {
    throw new Error(`Failed ${context}:\n${result.output}`)
  }

  return parseJson(result.output, context)
}

function gitlabApiBaseUrl () {
  return `http://127.0.0.1:${process.env.TASK_GITLAB_WEB_PORT || '8929'}`
}

function resolveGitLabDockerNetwork () {
  const result = runCommandWithResult("docker network ls --format '{{.Name}}'")
  if (result.exitCode !== 0) {
    throw new Error(`Failed to list docker networks:\n${result.output}`)
  }

  const networks = result.output
    .split('\n')
    .map(function (line) { return line.trim() })
    .filter(Boolean)
  const directMatch = networks.find(function (network) {
    return network === GITLAB_DOCKER_NETWORK_ALIAS
  })
  if (directMatch) {
    return directMatch
  }

  const prefixedMatch = networks.find(function (network) {
    return network.endsWith(`_${GITLAB_DOCKER_NETWORK_ALIAS}`)
  })

  if (prefixedMatch) {
    return prefixedMatch
  }

  throw new Error(
    `Unable to find GitLab docker network for alias "${GITLAB_DOCKER_NETWORK_ALIAS}".` +
    ` Known networks: ${networks.join(', ')}`
  )
}

function shellEscape (value) {
  const quote = String.fromCharCode(39)
  const escapedQuote = quote + '"' + quote + '"' + quote

  return quote + String(value).replace(/'/g, escapedQuote) + quote
}

function containerName () {
  return `ttyd-bootstrap-${crypto.randomBytes(4).toString('hex')}`
}

function randomPort () {
  const min = 20000
  const max = 30000

  return min + Math.floor(Math.random() * (max - min))
}

function execInContainer (name, command) {
  return runCommandWithResult(
    `docker exec ${shellEscape(name)} sh -c ${shellEscape(command)}`
  )
}

function userHome (user) {
  return user === 'root' ? '/root' : `/home/${user}`
}

function execInContainerAsUser (name, user, command, options = {}) {
  const wrappedCommand = [
    'set -eu',
    `export HOME=${userHome(user)}`,
    `export USER=${user}`,
    `export LOGNAME=${user}`,
    command
  ].join('\n')

  return runCommandWithResult(
    `docker exec -u ${shellEscape(user)} ${shellEscape(name)} sh -c ${shellEscape(wrappedCommand)}`,
    options
  )
}

function prepareDockerScenarioUser (scenario) {
  const user = scenario.dockerUserName || DOCKER_SCENARIO_USER
  const result = execInContainer(scenario.dockerContainerName, [
    'set -eu',
    'apt-get update -qq',
    'apt-get install -y -qq sudo',
    `if ! id ${shellEscape(user)} >/dev/null 2>&1; then`,
    `  useradd -m -s /bin/bash ${shellEscape(user)}`,
    'fi',
    `echo ${shellEscape(`${user} ALL=(ALL) NOPASSWD:ALL`)} > /etc/sudoers.d/${shellEscape(user)}`,
    `chmod 0440 /etc/sudoers.d/${shellEscape(user)}`,
    `mkdir -p ${CONTAINER_WORKDIR}`,
    `chown -R ${shellEscape(user)}:${shellEscape(user)} ${CONTAINER_WORKDIR}`
  ].join('\n'))

  if (result.exitCode !== 0) {
    throw new Error(`Failed to prepare non-root docker user "${user}":\n${result.output}`)
  }
}

function removeContainer (name) {
  try {
    runCommand(`docker rm -f ${shellEscape(name)}`)
  } catch (_) {
    // Ignore cleanup failures.
  }
}

function waitForTtyd (port, timeoutMs) {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    try {
      runCommand(`curl -sf http://${dockerHost()}:${port}/ >/dev/null 2>&1`) // DevSkim: ignore DS162092
      return true
    } catch (_) {
      execSync('sleep 0.5')
    }
  }

  throw new Error(`ttyd did not become ready on port ${port} within ${timeoutMs}ms`)
}

Before(function (scenario) { // eslint-disable-line no-undef
  this.ttydPort = null
  this.ttydContainerName = null
  this.ttydGeneratedProjectDir = null
  this.dockerContainerName = null
  this.lastCommandOutput = null
  this.lastCommandExitCode = null
  this.dockerOutput = ''
  this.dockerUserName = DOCKER_SCENARIO_USER
  this.gitlabStackStarted = false
  this.gitlabDockerNetworkName = null
  const name = (scenario && scenario.pickle && scenario.pickle.name) || 'scenario'
  this.dockerScenarioSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
})

After(function () { // eslint-disable-line no-undef
  if (this.ttydContainerName) {
    removeContainer(this.ttydContainerName)
    const index = activeContainers.indexOf(this.ttydContainerName)

    if (index !== -1) {
      activeContainers.splice(index, 1)
    }
  }

  if (this.ttydGeneratedProjectDir) {
    fs.rmSync(path.dirname(this.ttydGeneratedProjectDir), { recursive: true, force: true })
  }

  if (this.dockerContainerName) {
    if (this.dockerOutput) {
      const outputDir = path.resolve(__dirname, '..', '_output')
      fs.mkdirSync(outputDir, { recursive: true })
      fs.writeFileSync(path.join(outputDir, `${this.dockerScenarioSlug}.log`), this.dockerOutput)
    }

    removeContainer(this.dockerContainerName)
    const index = activeContainers.indexOf(this.dockerContainerName)

    if (index !== -1) {
      activeContainers.splice(index, 1)
    }
  }

  if (this.gitlabStackStarted) {
    runCommandWithResult('cd project && docker compose down', { timeout: GITLAB_STACK_TIMEOUT })
  }
})

function setupTtydContainer (scenario, options = {}) {
  const { extraPackages = [], gitRemote } = options

  const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttyd-bootstrap-'))
  scenario.ttydGeneratedProjectDir = path.join(tempBaseDir, 'generated')
  fs.mkdirSync(scenario.ttydGeneratedProjectDir, { recursive: true })

  executeCopier(scenario.ttydGeneratedProjectDir)

  const taskBinary = fs.realpathSync(runCommand('command -v task').trim())
  scenario.ttydPort = randomPort()
  scenario.ttydContainerName = containerName()

  runCommand(
    [
      'docker run -d',
      `--name ${shellEscape(scenario.ttydContainerName)}`,
      `-p ${scenario.ttydPort}:7681`,
      'ubuntu:24.04',
      'bash -c', shellEscape('while :; do sleep 10 & wait; done')
    ].join(' ')
  )
  activeContainers.push(scenario.ttydContainerName)

  execInContainer(scenario.ttydContainerName, `mkdir -p ${CONTAINER_WORKDIR}`)

  runCommand(`docker cp ${shellEscape(taskBinary)} ${shellEscape(`${scenario.ttydContainerName}:/usr/local/bin/task`)}`)
  runCommand(`docker cp ${shellEscape(`${scenario.ttydGeneratedProjectDir}/.`)} ${shellEscape(`${scenario.ttydContainerName}:${CONTAINER_WORKDIR}`)}`)

  const allPackages = ['sudo', 'curl'].concat(extraPackages)
  const prepareResult = execInContainer(scenario.ttydContainerName, [
    'set -eu',
    'apt-get update -qq',
    `apt-get install -y -qq ${allPackages.join(' ')}`,
    'if ! id bootstrap >/dev/null 2>&1; then',
    '  useradd -m -s /bin/bash bootstrap',
    'fi',
    'echo "bootstrap ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/bootstrap',
    'chmod 0440 /etc/sudoers.d/bootstrap',
    `chown -R bootstrap:bootstrap ${CONTAINER_WORKDIR}`,
    'chmod 0755 /usr/local/bin/task',
    'echo \'PROMPT_COMMAND="touch /tmp/ttyd-cmd-done"\' >> /home/bootstrap/.bashrc'
  ].join('\n'))

  if (prepareResult.exitCode !== 0) {
    throw new Error(`Failed to prepare ttyd container:\n${prepareResult.output}`)
  }

  if (gitRemote) {
    const gitResult = execInContainer(scenario.ttydContainerName, [
      'set -eu',
      `cd ${CONTAINER_WORKDIR}`,
      `git config --global --add safe.directory ${CONTAINER_WORKDIR}`,
      'git config --global user.email "bootstrap@example.com"',
      'git config --global user.name "Bootstrap"',
      'git init -q',
      'git add .',
      'git commit -q -m "bootstrap init"',
      `git remote add origin ${gitRemote}`
    ].join('\n'))

    if (gitResult.exitCode !== 0) {
      throw new Error(`Failed to set up git remote:\n${gitResult.output}`)
    }
  }

  const ttydInstall = execInContainer(scenario.ttydContainerName, [
    'set -eu',
    'TTYD_VERSION="1.7.7"',
    'UNAME_ARCH="$(uname -m)"',
    'curl -fsSL "https://github.com/tsl0922/ttyd/releases/download/$TTYD_VERSION/ttyd.$UNAME_ARCH" -o /usr/local/bin/ttyd',
    'chmod +x /usr/local/bin/ttyd'
  ].join('\n'))

  if (ttydInstall.exitCode !== 0) {
    throw new Error(`Failed to install ttyd:\n${ttydInstall.output}`)
  }

  const ttydStart = execInContainer(scenario.ttydContainerName, [
    'set -eu',
    `nohup su - bootstrap -c 'cd ${CONTAINER_WORKDIR} && PROMPT_COMMAND="touch /tmp/ttyd-cmd-done" ttyd -p 7681 -W -t scrollback=5000 bash' >/tmp/ttyd.log 2>&1 &`,
    'sleep 1'
  ].join('\n'))

  if (ttydStart.exitCode !== 0) {
    throw new Error(`Failed to start ttyd:\n${ttydStart.output}`)
  }

  waitForTtyd(scenario.ttydPort, TTYD_READY_TIMEOUT)
}

Given('a generated toolbox project is mounted in a fresh Ubuntu ttyd container', function () { // eslint-disable-line no-undef
  setupTtydContainer(this)
})

Given('a generated toolbox project with git remote {string} is mounted in a fresh Ubuntu ttyd container', function (gitRemote) { // eslint-disable-line no-undef
  setupTtydContainer(this, { extraPackages: ['git', 'unzip'], gitRemote })
})

Given('a generated toolbox project is mounted in a fresh Ubuntu ttyd container with extra packages {string}', function (packages) { // eslint-disable-line no-undef
  setupTtydContainer(this, { extraPackages: packages.split(/\s+/) })
})

Given('I set docker container name to {string}', function (containerNameValue) { // eslint-disable-line no-undef
  this.dockerContainerName = containerNameValue
})

Given('I run host command {string}', function (command) { // eslint-disable-line no-undef
  const result = runHostCommandInScenario(this, command)
  if (result.exitCode !== 0) {
    throw new Error(`Host command failed with exit code ${result.exitCode}:\n${command}\n${result.output}`)
  }
})

function parseHostCommandsBlock (commandsBlock) {
  const rawCommands = typeof commandsBlock === 'string'
    ? commandsBlock
    : (commandsBlock && typeof commandsBlock.content === 'string' ? commandsBlock.content : String(commandsBlock))

  return rawCommands
    .split('\n')
    .map(function (line) { return line.trim() })
    .filter(function (line) { return line !== '' && !line.startsWith('#') })
}

Given('I run host commands:', function (commandsBlock) { // eslint-disable-line no-undef
  const commands = parseHostCommandsBlock(commandsBlock)

  for (const command of commands) {
    const result = runHostCommandInScenario(this, command)
    if (result.exitCode !== 0) {
      throw new Error(`Host command failed with exit code ${result.exitCode}:\n${command}\n${result.output}`)
    }
  }
})

When('I run host command {string}', function (command) { // eslint-disable-line no-undef
  runHostCommandInScenario(this, command)
})

When('I run host commands:', function (commandsBlock) { // eslint-disable-line no-undef
  const commands = parseHostCommandsBlock(commandsBlock)

  for (const command of commands) {
    const result = runHostCommandInScenario(this, command)
    if (result.exitCode !== 0) {
      break
    }
  }
})

Given('the repository file {string} is copied into the ttyd container', function (filePath) { // eslint-disable-line no-undef
  const srcPath = path.join(REPO_ROOT, filePath)
  if (!fs.existsSync(srcPath)) {
    throw new Error(`Repository file "${filePath}" not found at "${srcPath}"`)
  }
  runCommand(`docker cp ${shellEscape(srcPath)} ${shellEscape(`${this.ttydContainerName}:${CONTAINER_WORKDIR}/${filePath}`)}`)
  execInContainer(this.ttydContainerName, `chown bootstrap:bootstrap ${CONTAINER_WORKDIR}/${shellEscape(filePath)}`)
})

When('I open the web terminal', async function () { // eslint-disable-line no-undef
  I.amOnPage(`http://${dockerHost()}:${this.ttydPort}`) // DevSkim: ignore DS162092
  I.waitForElement('.xterm-screen', 10)
  I.wait(3)
})

When('I type {string} in the terminal and wait for completion', async function (command) { // eslint-disable-line no-undef
  execInContainer(this.ttydContainerName, 'rm -f /tmp/ttyd-cmd-done')
  I.click('.xterm-screen')
  I.type(command)
  I.pressKey('Enter')
  await I.wait(5)

  const name = shellEscape(this.ttydContainerName)
  const cmd = 'while [ ! -f /tmp/ttyd-cmd-done ]; do sleep 1; done; sleep 2'

  try {
    execSync(`docker exec ${name} bash -c ${shellEscape(cmd)}`, {
      encoding: 'utf-8',
      timeout: TERMINAL_CMD_TIMEOUT
    })
  } catch (error) {
    if (error.killed) {
      const markerCheck = execInContainer(this.ttydContainerName, 'ls -la /tmp/ttyd-cmd-done 2>&1 || echo "MARKER_NOT_FOUND"')
      const procCheck = execInContainer(this.ttydContainerName, 'ps aux 2>&1 | head -20')
      const logCheck = execInContainer(this.ttydContainerName, 'cat /tmp/ttyd.log 2>&1 | tail -10')
      const bashrcCheck = execInContainer(this.ttydContainerName, 'su - bootstrap -c "grep PROMPT_COMMAND ~/.bashrc" 2>&1')
      throw new Error(
        `Timed out waiting for command "${command}" after ${TERMINAL_CMD_TIMEOUT}ms\n` +
        `--- Marker: ${markerCheck.output.trim()}\n` +
        `--- PROMPT_COMMAND in bashrc: ${bashrcCheck.output.trim()}\n` +
        `--- Processes:\n${procCheck.output.trim()}\n` +
        `--- ttyd log:\n${logCheck.output.trim()}`
      )
    }
    throw error
  }
})

Then('the terminal output should visually match {string}', async function (baselineName) { // eslint-disable-line no-undef
  await I.wait(1)
  I.resizeWindow(1920, 1080)
  await I.wait(2)

  const outputDir = path.resolve(__dirname, '..', '_output')

  const scrollInfo = await I.executeScript(function () {
    const vp = document.querySelector('.xterm-viewport')
    if (!vp) return null
    return { scrollHeight: vp.scrollHeight, clientHeight: vp.clientHeight }
  })

  if (scrollInfo && scrollInfo.scrollHeight > scrollInfo.clientHeight) {
    const pageHeight = scrollInfo.clientHeight
    const totalHeight = scrollInfo.scrollHeight
    const pageCount = Math.ceil(totalHeight / pageHeight)
    const contentPages = []

    for (let i = 0; i < pageCount; i++) {
      const scrollPos = (i < pageCount - 1) ? i * pageHeight : totalHeight - pageHeight
      await I.executeScript(function (pos) {
        document.querySelector('.xterm-viewport').scrollTop = pos
      }, scrollPos)
      await I.wait(0.5)
      I.moveCursorTo('body', 1, 1)
      await I.wait(0.3)

      const pagePath = path.resolve(outputDir, `_scroll_${baselineName}_p${i}.png`)
      await I.usePlaywrightTo('capture scroll page', async ({ page }) => {
        await page.screenshot({ path: pagePath })
      })
      contentPages.push(pagePath)
    }

    const pagesBase64 = contentPages.map(function (f) {
      return fs.readFileSync(f).toString('base64')
    })
    const lastPageVisible = totalHeight - (pageCount - 1) * pageHeight
    const stitchHeight = (contentPages.length - 1) * pageHeight + lastPageVisible
    const fullPath = path.resolve(outputDir, `${baselineName}-full.png`)

    await I.usePlaywrightTo('stitch scrolling screenshots', async ({ browser }) => {
      const stitchPage = await browser.newPage()
      await stitchPage.setViewportSize({ width: 1920, height: Math.min(stitchHeight, 16000) })
      await stitchPage.setContent(
        '<!DOCTYPE html><html><body style="margin:0;padding:0">' +
        '<canvas id="c" width="1920" height="' + stitchHeight + '"></canvas>' +
        '</body></html>'
      )

      for (let i = 0; i < pagesBase64.length; i++) {
        const isLast = (i === pagesBase64.length - 1)
        const yDest = i * pageHeight
        const srcY = isLast ? (pageHeight - lastPageVisible) : 0
        const drawH = isLast ? lastPageVisible : pageHeight

        await stitchPage.evaluate(async (args) => {
          return new Promise(function (resolve) {
            const img = new window.Image()
            img.onload = function () {
              const ctx = document.getElementById('c').getContext('2d')
              ctx.drawImage(img, 0, args.srcY, 1920, args.drawH, 0, args.yDest, 1920, args.drawH)
              resolve()
            }
            img.src = 'data:image/png;base64,' + args.b64
          })
        }, { b64: pagesBase64[i], srcY, drawH, yDest })
      }

      await stitchPage.screenshot({ path: fullPath, fullPage: true })
      await stitchPage.close()
    })

    contentPages.forEach(function (f) { try { fs.unlinkSync(f) } catch (e) { /* ignore */ } })

    await I.executeScript(function (max) {
      document.querySelector('.xterm-viewport').scrollTop = max
    }, totalHeight)
    await I.wait(0.5)
  }

  I.moveCursorTo('body', 1, 1)
  I.takeScreenshot(baselineName)
  I.assertVisualMatch(baselineName)
  I.resizeWindow(1024, 768)
  await I.wait(1)
})

Then('I take a terminal screenshot named {string}', async function (name) { // eslint-disable-line no-undef
  I.wait(1)
  I.saveScreenshot(`${name}.png`)
})

Given('the GitLab test stack is started with docker compose', function () { // eslint-disable-line no-undef
  const result = runCommandWithResult(
    'cd project && docker compose up -d codeceptjs --wait',
    { timeout: GITLAB_STACK_TIMEOUT }
  )

  this.dockerOutput += result.output
  this.gitlabStackStarted = true

  if (result.exitCode !== 0) {
    throw new Error(`Failed to start GitLab test stack:\n${result.output}`)
  }
})

Given('a fresh Ubuntu docker container is running', function () { // eslint-disable-line no-undef
  this.dockerContainerName = containerName()
  runCommand(
    [
      'docker run -d',
      `--name ${shellEscape(this.dockerContainerName)}`,
      'ubuntu:24.04',
      'bash -c', shellEscape('while :; do sleep 10 & wait; done')
    ].join(' ')
  )
  activeContainers.push(this.dockerContainerName)
  prepareDockerScenarioUser(this)
})

Given('a fresh Ubuntu docker container is running on the GitLab test network', function () { // eslint-disable-line no-undef
  const gitlabNetwork = resolveGitLabDockerNetwork()
  this.dockerContainerName = containerName()
  this.gitlabDockerNetworkName = gitlabNetwork
  runCommand(
    [
      'docker run -d',
      `--name ${shellEscape(this.dockerContainerName)}`,
      `--network ${shellEscape(gitlabNetwork)}`,
      'ubuntu:24.04',
      'bash -c', shellEscape('while :; do sleep 10 & wait; done')
    ].join(' ')
  )
  activeContainers.push(this.dockerContainerName)
  prepareDockerScenarioUser(this)
})

Given('the local file {string} is copied into the container at {string}', function (localPath, containerPath) { // eslint-disable-line no-undef
  const srcPath = path.join(REPO_ROOT, localPath)
  runCommand(`docker cp ${shellEscape(srcPath)} ${shellEscape(`${this.dockerContainerName}:${containerPath}`)}`)
  if (this.dockerUserName) {
    const ownershipResult = execInContainer(
      this.dockerContainerName,
      `chown ${shellEscape(this.dockerUserName)}:${shellEscape(this.dockerUserName)} ${shellEscape(containerPath)}`
    )
    if (ownershipResult.exitCode !== 0) {
      throw new Error(`Failed to set ownership for "${containerPath}" to "${this.dockerUserName}":\n${ownershipResult.output}`)
    }
  }
})

Given('the packages {string} are installed in the container', function (packages) { // eslint-disable-line no-undef
  const result = execInContainer(this.dockerContainerName, `apt-get update -qq && apt-get install -y -qq ${packages}`)
  if (result.exitCode !== 0) {
    throw new Error(`Failed to install packages "${packages}":\n${result.output}`)
  }
})

Given('a git repository is initialized at {string} in the container', function (dir) { // eslint-disable-line no-undef
  const result = execInContainerAsUser(this.dockerContainerName, this.dockerUserName || 'root', [
    'set -eu',
    `mkdir -p ${dir}`,
    `cd ${dir}`,
    `git config --global --add safe.directory ${dir}`,
    'git config --global user.email "test@test.com"',
    'git config --global user.name "Test"',
    'git init -q',
    'git commit -q --allow-empty -m "init"'
  ].join('\n'))
  if (result.exitCode !== 0) {
    throw new Error(`Failed to initialize git repository at "${dir}":\n${result.output}`)
  }
})

Given('a GitLab remote project {string} is configured for {string} in the container', function (projectName, dir) { // eslint-disable-line no-undef
  if (!this.dockerContainerName) {
    throw new Error('No docker container is running for this scenario.')
  }

  const baseUrl = gitlabApiBaseUrl()
  const rootUser = process.env.TASK_GITLAB_ROOT_USER || 'root'
  const rootPassword = process.env.TASK_GITLAB_ROOT_PASSWORD || 'devsecops-toolbox-password'
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER || 'lambda'
  const lambdaPassword = process.env.TASK_GITLAB_LAMBDA_PASSWORD || 'Xk9#mQ2$vR7nB4wZ'
  const lambdaEmail = process.env.TASK_GITLAB_LAMBDA_EMAIL || 'lambda@test.local'
  const gitlabProjectName = `${projectName}-${crypto.randomBytes(3).toString('hex')}`

  const authData = runCurlJson(
    {
      method: 'POST',
      url: `${baseUrl}/oauth/token`,
      dataUrlencoded: [
        'grant_type=password',
        `username=${rootUser}`,
        `password=${rootPassword}`
      ]
    },
    'GitLab OAuth token request'
  )

  const rootToken = authData.access_token
  if (!rootToken) {
    throw new Error(`GitLab OAuth token missing in response: ${JSON.stringify(authData)}`)
  }

  let users = runCurlJson(
    {
      method: 'GET',
      url: `${baseUrl}/api/v4/users?username=${encodeURIComponent(lambdaUser)}`,
      headers: [`Authorization: Bearer ${rootToken}`]
    },
    'GitLab user lookup'
  )

  if (!Array.isArray(users) || users.length === 0) {
    runCurlJson(
      {
        method: 'POST',
        url: `${baseUrl}/api/v4/users`,
        headers: [`Authorization: Bearer ${rootToken}`],
        jsonBody: {
          email: lambdaEmail,
          username: lambdaUser,
          name: 'Lambda User',
          password: lambdaPassword,
          skip_confirmation: true,
          force_random_password: false,
          reset_password: false
        }
      },
      'GitLab lambda user creation'
    )

    users = runCurlJson(
      {
        method: 'GET',
        url: `${baseUrl}/api/v4/users?username=${encodeURIComponent(lambdaUser)}`,
        headers: [`Authorization: Bearer ${rootToken}`]
      },
      'GitLab lambda user re-lookup'
    )
  }

  const lambdaData = Array.isArray(users) ? users[0] : null
  if (!lambdaData || !lambdaData.id) {
    throw new Error(`Unable to resolve lambda user ID from GitLab response: ${JSON.stringify(users)}`)
  }

  const projects = runCurlJson(
    {
      method: 'GET',
      url: `${baseUrl}/api/v4/users/${lambdaData.id}/projects?search=${encodeURIComponent(gitlabProjectName)}&simple=true&per_page=100`,
      headers: [`Authorization: Bearer ${rootToken}`]
    },
    'GitLab project lookup'
  )

  const existingProject = Array.isArray(projects)
    ? projects.find(function (project) { return project.path === gitlabProjectName })
    : null

  if (!existingProject) {
    runCurlJson(
      {
        method: 'POST',
        url: `${baseUrl}/api/v4/projects`,
        headers: [`Authorization: Bearer ${rootToken}`],
        jsonBody: {
          name: gitlabProjectName,
          namespace_id: lambdaData.id,
          visibility: 'private'
        }
      },
      'GitLab project creation'
    )
  }

  const patName = `bootstrap-installer-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`
  const patData = runCurlJson(
    {
      method: 'POST',
      url: `${baseUrl}/api/v4/users/${lambdaData.id}/personal_access_tokens`,
      headers: [`Authorization: Bearer ${rootToken}`],
      jsonBody: {
        name: patName,
        scopes: ['api', 'write_repository']
      }
    },
    'GitLab personal access token creation'
  )

  const glabToken = patData.token
  if (!glabToken) {
    throw new Error(`GitLab personal access token missing in response: ${JSON.stringify(patData)}`)
  }

  if (!this.gitlabDockerNetworkName) {
    const networkConnect = runCommandWithResult(
      `docker network connect ${shellEscape(resolveGitLabDockerNetwork())} ${shellEscape(this.dockerContainerName)}`
    )
    if (
      networkConnect.exitCode !== 0 &&
      !/already exists|already connected/i.test(networkConnect.output)
    ) {
      throw new Error(`Failed to connect container to GitLab network:\n${networkConnect.output}`)
    }
  }

  const dockerUser = this.dockerUserName || 'root'
  const dockerUserHome = userHome(dockerUser)
  const encodedToken = encodeURIComponent(glabToken)
  const remoteUrlWithToken = `http://${lambdaUser}:${encodedToken}@gitlab/${lambdaUser}/${gitlabProjectName}.git`
  const glabConfigLines = [
    'hosts:',
    '  gitlab:',
    '    api_host: gitlab:80',
    '    api_protocol: http',
    '    git_protocol: http',
    `    token: ${glabToken}`,
    `    user: ${lambdaUser}`
  ]
  const glabConfigWriteCmd = `printf '%s\\n' ${glabConfigLines.map(shellEscape).join(' ')} > ${shellEscape(`${dockerUserHome}/.config/glab-cli/config.yml`)}`

  const setupRepoResult = execInContainerAsUser(this.dockerContainerName, dockerUser, [
    'set -eu',
    `cd ${dir}`,
    'git branch -M main',
    'if git remote get-url origin >/dev/null 2>&1; then',
    '  git remote remove origin',
    'fi',
    `git remote add origin "${remoteUrlWithToken}"`,
    'git push -u origin main',
    `mkdir -p ${shellEscape(`${dockerUserHome}/.config/glab-cli`)}`,
    glabConfigWriteCmd,
    `chmod 0600 ${shellEscape(`${dockerUserHome}/.config/glab-cli/config.yml`)}`,
    `git remote set-url origin "http://gitlab/${lambdaUser}/${gitlabProjectName}.git"`
  ].join('\n'))

  if (setupRepoResult.exitCode !== 0) {
    throw new Error(`Failed to configure GitLab remote project "${gitlabProjectName}":\n${setupRepoResult.output}`)
  }
})

When('I run {string} from {string} in the container', function (command, dir) { // eslint-disable-line no-undef
  const result = execInContainerAsUser(
    this.dockerContainerName,
    this.dockerUserName || 'root',
    `cd ${dir} && ${command}`,
    { timeout: TERMINAL_CMD_TIMEOUT }
  )
  this.lastCommandOutput = result.output
  this.lastCommandExitCode = result.exitCode
  this.dockerOutput += result.output
})

When('I run the install script with default answers from {string} in the container', function (dir) { // eslint-disable-line no-undef
  const defaultAnswers = '\\n'.repeat(DEFAULT_INSTALL_ANSWERS_COUNT)
  const result = execInContainerAsUser(
    this.dockerContainerName,
    this.dockerUserName || 'root',
    `cd ${dir} && printf '%b' "${defaultAnswers}" | bash /tmp/install.sh`,
    { timeout: INSTALL_SCRIPT_TIMEOUT }
  )
  this.lastCommandOutput = result.output
  this.lastCommandExitCode = result.exitCode
  this.dockerOutput += result.output
})

Then('the command output should contain {string}', function (expected) { // eslint-disable-line no-undef
  if (!this.lastCommandOutput.includes(expected)) {
    throw new Error(`Expected output to contain "${expected}" but got:\n${this.lastCommandOutput}`)
  }
})

Then('the command should exit with code {int}', function (expectedExitCode) { // eslint-disable-line no-undef
  if (this.lastCommandExitCode !== expectedExitCode) {
    throw new Error(
      `Expected exit code ${expectedExitCode} but got ${this.lastCommandExitCode}.\n` +
      `Output:\n${this.lastCommandOutput || ''}`
    )
  }
})

Then('the command should fail', function () { // eslint-disable-line no-undef
  if (this.lastCommandExitCode === 0) {
    throw new Error(
      'Expected command to fail with a non-zero exit code, but got 0.\n' +
      `Output:\n${this.lastCommandOutput || ''}`
    )
  }
})

When('the command output is displayed in the browser', async function () { // eslint-disable-line no-undef
  const raw = (this.dockerOutput || '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
  const output = raw.split('\n').slice(-20).join('\n')
  await I.usePlaywrightTo('render command output in browser', async ({ page }) => {
    await page.setContent(
      '<!DOCTYPE html><html><body style="background:#1e1e1e;margin:0;padding:16px">' +
      '<pre style="color:#d4d4d4;font-family:monospace;font-size:14px;white-space:pre-wrap;word-break:break-all">' +
      output.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
      '</pre></body></html>'
    )
  })
})
