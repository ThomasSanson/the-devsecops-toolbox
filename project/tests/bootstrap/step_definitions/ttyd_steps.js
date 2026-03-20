const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execSync } = require('child_process')

const {
  GITLAB_DOCKER_NETWORK_ALIAS,
  dockerHost,
  shellEscape,
  stripAnsiEscapeSequences,
  runCommand,
  runCommandWithResult,
  gitlabApiBaseUrl,
  collectGitlabComposeDiagnostics,
  withGitlabDiagnostics,
  waitForGitlabReady,
  runGitlabApiJson,
  resolveGitLabDockerNetwork,
  containerName,
  randomPort,
  execInContainer,
  execInContainerAsUser,
  userHome,
  removeContainer,
  waitForTtyd,
  runHostCommandInScenario
} = require('./helpers')

const { I } = global.inject()
const { executeCopier } = require('../../template/step_objects/commands')

const CONTAINER_WORKDIR = '/workspace'
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const TTYD_READY_TIMEOUT = 30000
const TERMINAL_CMD_TIMEOUT = 300000
const INSTALL_SCRIPT_TIMEOUT = 900000
const GITLAB_STACK_TIMEOUT = 900000
const DEFAULT_INSTALL_ANSWERS_COUNT = 40
const DOCKER_SCENARIO_USER = 'bootstrap'
const TERMINAL_SETTLE_TIMEOUT_SECONDS = 20
const TERMINAL_SETTLE_POLL_SECONDS = 0.25
const TERMINAL_SETTLE_STABLE_SAMPLES = 3
const TERMINAL_BOTTOM_TOLERANCE_PX = 12
const VISUAL_TAIL_LINE_COUNT = 10

const VISUAL_COMPLETION_MARKERS = [
  'Installation complete!',
  'Commit message passed Commitizen checks.',
  'Commit message passed commitlint.',
  'fatal: not a git repository'
]

const activeContainers = []

async function readTerminalState () {
  return I.executeScript(function (bottomTolerancePx) {
    const viewport = document.querySelector('.xterm-viewport')
    const screen = document.querySelector('.xterm-screen')

    if (!viewport || !screen) {
      return null
    }

    const textLength = (screen.textContent || '').length
    const scrollHeight = viewport.scrollHeight
    const clientHeight = viewport.clientHeight
    const scrollTop = viewport.scrollTop
    const expectedBottom = Math.max(0, scrollHeight - clientHeight)
    const atBottom = Math.abs(scrollTop - expectedBottom) <= bottomTolerancePx

    return {
      scrollHeight,
      clientHeight,
      scrollTop,
      textLength,
      atBottom
    }
  }, TERMINAL_BOTTOM_TOLERANCE_PX)
}

async function waitForTerminalSettle (timeoutSeconds = TERMINAL_SETTLE_TIMEOUT_SECONDS) {
  const startedAt = Date.now()
  let stableSamples = 0
  let previousState = null
  let latestState = null

  while ((Date.now() - startedAt) < (timeoutSeconds * 1000)) {
    latestState = await readTerminalState()
    if (!latestState) {
      await I.wait(TERMINAL_SETTLE_POLL_SECONDS)
      continue
    }

    const isStable = previousState &&
      previousState.scrollHeight === latestState.scrollHeight &&
      previousState.scrollTop === latestState.scrollTop &&
      previousState.textLength === latestState.textLength

    stableSamples = isStable ? stableSamples + 1 : 0
    previousState = latestState

    if (stableSamples >= TERMINAL_SETTLE_STABLE_SAMPLES) {
      return latestState
    }

    await I.wait(TERMINAL_SETTLE_POLL_SECONDS)
  }

  return latestState
}

async function scrollTerminalToBottom () {
  for (let attempt = 0; attempt < 8; attempt++) {
    const state = await I.executeScript(function (bottomTolerancePx) {
      const viewport = document.querySelector('.xterm-viewport')
      if (!viewport) {
        return null
      }
      const expectedBottom = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      viewport.scrollTop = expectedBottom

      return {
        atBottom: Math.abs(viewport.scrollTop - expectedBottom) <= bottomTolerancePx
      }
    }, TERMINAL_BOTTOM_TOLERANCE_PX)

    if (state && state.atBottom) {
      return true
    }

    await I.wait(0.2)
  }

  return false
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

  // Start container from pre-built ubuntu image via docker compose
  runCommand(
    `cd project && docker compose run -d --name ${shellEscape(scenario.ttydContainerName)} --publish ${scenario.ttydPort}:7681 ubuntu`,
    { timeout: GITLAB_STACK_TIMEOUT }
  )
  activeContainers.push(scenario.ttydContainerName)

  // Copy task binary and generated project into the container
  runCommand(`docker cp ${shellEscape(taskBinary)} ${shellEscape(`${scenario.ttydContainerName}:/usr/local/bin/task`)}`)
  runCommand(`docker cp ${shellEscape(`${scenario.ttydGeneratedProjectDir}/.`)} ${shellEscape(`${scenario.ttydContainerName}:${CONTAINER_WORKDIR}`)}`)

  // Install extra packages and fix ownership as root (no-new-privileges blocks sudo)
  const prepareCommands = ['set -eu']
  if (extraPackages.length > 0) {
    prepareCommands.push(
      'apt-get update -qq',
      `apt-get install -y -qq ${extraPackages.join(' ')}`
    )
  }
  prepareCommands.push(
    `chown -R bootstrap:bootstrap ${CONTAINER_WORKDIR}`,
    'chmod 0755 /usr/local/bin/task'
  )

  const prepareResult = execInContainer(scenario.ttydContainerName, prepareCommands.join('\n'), { user: 'root' })
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

  // Start ttyd as bootstrap user (already the default user in the image; .bashrc sets PROMPT_COMMAND)
  const ttydStart = execInContainer(scenario.ttydContainerName, [
    'set -eu',
    `cd ${CONTAINER_WORKDIR} && nohup ttyd -p 7681 -W -t scrollback=5000 bash >/tmp/ttyd.log 2>&1 &`,
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
  execInContainer(this.ttydContainerName, `chown bootstrap:bootstrap ${CONTAINER_WORKDIR}/${shellEscape(filePath)}`, { user: 'root' })
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
  const commandStartedAtEpoch = Math.floor(Date.now() / 1000)
  I.pressKey('Enter')
  await I.wait(5)

  const name = shellEscape(this.ttydContainerName)
  const cmd = [
    'while :; do',
    '  if [ -f /tmp/ttyd-cmd-done ]; then',
    '    marker_mtime="$(stat -c %Y /tmp/ttyd-cmd-done 2>/dev/null || echo 0)"',
    `    if [ "$marker_mtime" -ge "${commandStartedAtEpoch}" ]; then`,
    '      break',
    '    fi',
    '  fi',
    '  sleep 1',
    'done',
    'sleep 2'
  ].join('\n')

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
      const bashrcCheck = execInContainer(this.ttydContainerName, 'grep PROMPT_COMMAND /home/bootstrap/.bashrc 2>&1')
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

  await waitForTerminalSettle()
})

Then('the terminal output should visually match {string}', async function (baselineName) { // eslint-disable-line no-undef
  await I.wait(1)
  I.resizeWindow(1920, 1080)
  await I.wait(2)
  await waitForTerminalSettle()

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

    await scrollTerminalToBottom()
    await waitForTerminalSettle()
  }

  await scrollTerminalToBottom()
  await waitForTerminalSettle()
  let finalState = await readTerminalState()
  if (!finalState || !finalState.atBottom) {
    await scrollTerminalToBottom()
    await waitForTerminalSettle(3)
    finalState = await readTerminalState()
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
    throw new Error(
      `Failed to start GitLab test stack:\n${result.output}\n${collectGitlabComposeDiagnostics()}`
    )
  }

  try {
    waitForGitlabReady(gitlabApiBaseUrl(), GITLAB_STACK_TIMEOUT)
  } catch (error) {
    throw withGitlabDiagnostics(error, 'GitLab stack started but readiness check failed')
  }
})

Given('a fresh Ubuntu docker container is running', function () { // eslint-disable-line no-undef
  this.dockerContainerName = containerName()
  runCommand(
    `cd project && docker compose run -d --name ${shellEscape(this.dockerContainerName)} ubuntu`,
    { timeout: GITLAB_STACK_TIMEOUT }
  )
  activeContainers.push(this.dockerContainerName)
})

Given('a fresh Ubuntu docker container is running on the GitLab test network', function () { // eslint-disable-line no-undef
  this.dockerContainerName = containerName()
  this.gitlabDockerNetworkName = GITLAB_DOCKER_NETWORK_ALIAS
  runCommand(
    `cd project && docker compose run -d --name ${shellEscape(this.dockerContainerName)} ubuntu`,
    { timeout: GITLAB_STACK_TIMEOUT }
  )
  activeContainers.push(this.dockerContainerName)
})

Given('the local file {string} is copied into the container at {string}', function (localPath, containerPath) { // eslint-disable-line no-undef
  const srcPath = path.join(REPO_ROOT, localPath)
  runCommand(`docker cp ${shellEscape(srcPath)} ${shellEscape(`${this.dockerContainerName}:${containerPath}`)}`)
  if (this.dockerUserName) {
    const ownershipResult = execInContainer(
      this.dockerContainerName,
      `chown ${shellEscape(this.dockerUserName)}:${shellEscape(this.dockerUserName)} ${shellEscape(containerPath)}`,
      { user: 'root' }
    )
    if (ownershipResult.exitCode !== 0) {
      throw new Error(`Failed to set ownership for "${containerPath}" to "${this.dockerUserName}":\n${ownershipResult.output}`)
    }
  }
})

Given('the local directory {string} is copied into the container at {string}', function (localPath, containerPath) { // eslint-disable-line no-undef
  const srcPath = path.join(REPO_ROOT, localPath)
  if (!fs.existsSync(srcPath)) {
    throw new Error(`Local directory "${localPath}" not found at "${srcPath}"`)
  }
  if (!fs.statSync(srcPath).isDirectory()) {
    throw new Error(`Path "${localPath}" is not a directory`)
  }

  const cleanupResult = execInContainer(this.dockerContainerName, `rm -rf ${shellEscape(containerPath)}`, { user: 'root' })
  if (cleanupResult.exitCode !== 0) {
    throw new Error(`Failed to clean target directory "${containerPath}":\n${cleanupResult.output}`)
  }

  runCommand(`docker cp ${shellEscape(`${srcPath}/.`)} ${shellEscape(`${this.dockerContainerName}:${containerPath}`)}`)

  if (this.dockerUserName) {
    const ownershipResult = execInContainer(
      this.dockerContainerName,
      `chown -R ${shellEscape(this.dockerUserName)}:${shellEscape(this.dockerUserName)} ${shellEscape(containerPath)}`,
      { user: 'root' }
    )
    if (ownershipResult.exitCode !== 0) {
      throw new Error(`Failed to set recursive ownership for "${containerPath}" to "${this.dockerUserName}":\n${ownershipResult.output}`)
    }
  }
})

Given('the packages {string} are installed in the container', function (packages) { // eslint-disable-line no-undef
  const result = execInContainer(this.dockerContainerName, `apt-get update -qq && apt-get install -y -qq ${packages}`, { user: 'root' })
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

  try {
    waitForGitlabReady(baseUrl, GITLAB_STACK_TIMEOUT)
  } catch (error) {
    throw withGitlabDiagnostics(error, 'GitLab readiness check failed before OAuth flow')
  }

  const authData = runGitlabApiJson(
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

  let users = runGitlabApiJson(
    {
      method: 'GET',
      url: `${baseUrl}/api/v4/users?username=${encodeURIComponent(lambdaUser)}`,
      headers: [`Authorization: Bearer ${rootToken}`]
    },
    'GitLab user lookup'
  )

  if (!Array.isArray(users) || users.length === 0) {
    runGitlabApiJson(
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

    users = runGitlabApiJson(
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

  const projects = runGitlabApiJson(
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
    runGitlabApiJson(
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
  const patData = runGitlabApiJson(
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
  const commandOutput = result.output || ''
  this.lastCommandOutput = commandOutput
  this.lastCommandExitCode = result.exitCode
  this.dockerOutput += commandOutput
})

When('I run {string} from {string} in the container via pseudo-tty with {int} default answers', function (command, dir, answersCount) { // eslint-disable-line no-undef
  if (!this.dockerContainerName) {
    throw new Error('No docker container is running for this scenario.')
  }

  const dockerUser = this.dockerUserName || 'root'
  const dockerExecCommand = [
    'docker exec',
    '-u', shellEscape(dockerUser),
    '-it',
    shellEscape(this.dockerContainerName),
    'sh -lc',
    shellEscape(`cd ${dir} && ${command}`)
  ].join(' ')
  const hostCommand = `yes '' | head -n ${answersCount} | script -qec ${shellEscape(dockerExecCommand)} /dev/null`
  const result = runCommandWithResult(hostCommand, { timeout: INSTALL_SCRIPT_TIMEOUT })

  const commandOutput = result.output || ''
  this.lastCommandOutput = commandOutput
  this.lastCommandExitCode = result.exitCode
  this.dockerOutput += commandOutput
})

When('I run the install script with default answers from {string} in the container', function (dir) { // eslint-disable-line no-undef
  const defaultAnswers = '\\n'.repeat(DEFAULT_INSTALL_ANSWERS_COUNT)
  const result = execInContainerAsUser(
    this.dockerContainerName,
    this.dockerUserName || 'root',
    `cd ${dir} && printf '%b' "${defaultAnswers}" | bash /tmp/install.sh`,
    { timeout: INSTALL_SCRIPT_TIMEOUT }
  )
  const commandOutput = result.output || ''
  this.lastCommandOutput = commandOutput
  this.lastCommandExitCode = result.exitCode
  this.dockerOutput += commandOutput
})

Then('the command output should contain {string}', function (expected) { // eslint-disable-line no-undef
  const output = this.lastCommandOutput || ''
  const fallbackOutput = this.dockerOutput || ''
  const normalizedOutput = stripAnsiEscapeSequences(output).replace(/\r/g, '')
  const normalizedFallbackOutput = stripAnsiEscapeSequences(fallbackOutput).replace(/\r/g, '')

  const found = output.includes(expected) ||
    normalizedOutput.includes(expected) ||
    fallbackOutput.includes(expected) ||
    normalizedFallbackOutput.includes(expected)

  if (!found) {
    throw new Error(`Expected output to contain "${expected}" but got:\n${output || fallbackOutput}`)
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
  const rawSource = this.lastCommandOutput || this.dockerOutput || ''
  const raw = stripAnsiEscapeSequences(rawSource).replace(/\r/g, '')
  const lines = raw.split('\n').filter(function (line) {
    const trimmed = line.trim()
    if (trimmed === '') {
      return true
    }

    // Filter noisy, non-deterministic JSON payloads printed by `glab api`.
    return !(
      trimmed.startsWith('{"id":') &&
      trimmed.includes('"name_with_namespace"') &&
      trimmed.includes('"default_branch"')
    )
  })

  let renderedLines = lines.slice(Math.max(0, lines.length - VISUAL_TAIL_LINE_COUNT))
  const completionMarkerMatch = VISUAL_COMPLETION_MARKERS
    .map(function (marker) {
      return {
        marker,
        index: lines.reduce(function (lastIndex, line, index) {
          return line.includes(marker) ? index : lastIndex
        }, -1)
      }
    })
    .filter(function (entry) { return entry.index >= 0 })
    .sort(function (a, b) { return b.index - a.index })[0]

  if (
    completionMarkerMatch &&
    !renderedLines.some(function (line) { return line.includes(completionMarkerMatch.marker) })
  ) {
    const sliceEnd = completionMarkerMatch.index + 1
    const sliceStart = Math.max(0, sliceEnd - VISUAL_TAIL_LINE_COUNT)
    renderedLines = lines.slice(sliceStart, sliceEnd)
  }

  const output = renderedLines.join('\n')
  await I.usePlaywrightTo('render command output in browser', async ({ page }) => {
    await page.setContent(
      '<!DOCTYPE html><html><body style="background:#1e1e1e;margin:0;padding:16px">' +
      '<pre style="color:#d4d4d4;font-family:monospace;font-size:14px;white-space:pre-wrap;word-break:break-all">' +
      output.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
      '</pre></body></html>'
    )
  })
})
