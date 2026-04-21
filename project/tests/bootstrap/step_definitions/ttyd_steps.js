const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  GITLAB_DOCKER_NETWORK_ALIAS,
  ttydPort,
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
// Inside the dockerised codeceptjs runner the full repo is tarred into
// `/workspace` by `project:test:bootstrap` before codeceptjs starts. The
// default keeps local (non-docker) runs working by falling back to a path
// relative to __dirname.
const REPO_ROOT = fs.existsSync('/workspace/project/docker-compose.yml')
  ? '/workspace'
  : path.resolve(__dirname, '..', '..', '..', '..')
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

const COMPACT_GLAB_AUTH_STATUS_COMMAND = [
  'clear',
  'export PATH="$HOME/.local/bin:$PATH"',
  'glab auth status || true'
].join('; ')

const COMPACT_TASK_GLAB_AUTH_STATUS_COMMAND = [
  'clear',
  'export PATH="$HOME/.local/bin:$PATH"',
  'task glab:auth:status'
].join('; ')

const COMPACT_TASK_GLAB_AUTH_COMMAND = [
  'clear',
  'export PATH="$HOME/.local/bin:$PATH"',
  'task glab:auth || true'
].join('; ')

// Lines matching these patterns are filtered from the terminal capture
// before the visual assertion. They represent install-time noise whose
// exact content or ordering is non-deterministic across CI runs.
const SHELL_PROMPT_RE = /bootstrap@workspace:[^\r\n]*\$\s*$/
const PROMPT_STABILITY_MS = 2000
const PROMPT_POLL_SECONDS = 1

const TERMINAL_NOISE_PATTERNS = [
  /^\(Reading database/,
  /^Preparing to unpack /,
  /^Unpacking /,
  /^Selecting previously unselected package/,
  /^Setting up /,
  /^Processing triggers for /,
  /^debconf: /,
  /^downloading /,
  /^Downloading \S+ \(/,
  /^Installed \d+ packages? in /,
  /^Resolved \d+ packages? in /,
  /^ \+ \S+==/,
  /^Prepared \d+ packages? in /,
  /^Audited \d+ packages? in /,
  /^go: downloading /,
  /^go: finding /,
  /^go: extracting /,
  /^Get:\d+ /,
  /^Fetched [\d.]+ .?B in /,
  /^Need to get /,
  /^After this operation, /,
  /^\d+ upgraded, /,
  /^update-alternatives: /,
  /^Reading package lists/,
  /^Building dependency tree/,
  /^Reading state information/,
  /^The following additional packages/,
  /^The following NEW packages/,
  /^\s+python3-/,
  /^npm notice/,
  /^added \d+ packages?, and audited /,
  /^\d+ packages? are looking for funding/,
  /^ {2}run `npm fund`/,
  /^found \d+ vulnerabilities/
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
    runCommandWithResult('cd /workspace/project && docker compose down', { timeout: GITLAB_STACK_TIMEOUT })
  }
})

function setupTtydContainer (scenario, options = {}) {
  const { extraPackages = [], gitRemote } = options

  const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttyd-bootstrap-'))
  scenario.ttydGeneratedProjectDir = path.join(tempBaseDir, 'generated')
  fs.mkdirSync(scenario.ttydGeneratedProjectDir, { recursive: true })

  executeCopier(scenario.ttydGeneratedProjectDir, {}, { cwd: REPO_ROOT })

  const taskBinary = fs.realpathSync(runCommand('command -v task').trim())
  scenario.ttydContainerName = containerName()

  // Start container from pre-built ubuntu image via docker compose.
  // No port publishing: the runner reaches ttyd through the shared
  // `the-devsecops-toolbox` network using the container hostname.
  runCommand(
    `cd /workspace/project && docker compose run -d --name ${shellEscape(scenario.ttydContainerName)} ubuntu`,
    { timeout: GITLAB_STACK_TIMEOUT }
  )
  activeContainers.push(scenario.ttydContainerName)

  // Copy task binary (from the runner's own filesystem, /usr/local/bin/task in
  // the codeceptjs image) and generated project into the container.
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
    ].join('\n'), { user: 'bootstrap' })

    if (gitResult.exitCode !== 0) {
      throw new Error(`Failed to set up git remote:\n${gitResult.output}`)
    }
  }

  // Start ttyd as bootstrap user (already the default user in the image; .bashrc sets PROMPT_COMMAND)
  const ttydStart = execInContainer(scenario.ttydContainerName, [
    'set -eu',
    `cd ${CONTAINER_WORKDIR} && nohup ttyd -p 7681 -W -t scrollback=5000 -t rendererType=dom bash >/tmp/ttyd.log 2>&1 &`,
    'sleep 1'
  ].join('\n'))

  if (ttydStart.exitCode !== 0) {
    throw new Error(`Failed to start ttyd:\n${ttydStart.output}`)
  }

  waitForTtyd(scenario.ttydContainerName, TTYD_READY_TIMEOUT)
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

Given('the ttyd project is connected to the GitLab test network with a valid glab login', function () { // eslint-disable-line no-undef
  if (!this.ttydContainerName) {
    throw new Error('No ttyd container is running for this scenario.')
  }

  const baseUrl = gitlabApiBaseUrl()
  const rootUser = process.env.TASK_GITLAB_ROOT_USER || 'root'
  const rootPassword = process.env.TASK_GITLAB_ROOT_PASSWORD || 'devsecops-toolbox-password'
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER || 'lambda'
  const lambdaPassword = process.env.TASK_GITLAB_LAMBDA_PASSWORD || 'Xk9#mQ2$vR7nB4wZ'
  const lambdaEmail = process.env.TASK_GITLAB_LAMBDA_EMAIL || 'lambda@test.local'
  const gitlabProjectName = `ttyd-glab-auth-${crypto.randomBytes(3).toString('hex')}`

  try {
    waitForGitlabReady(baseUrl, GITLAB_STACK_TIMEOUT)
  } catch (error) {
    throw withGitlabDiagnostics(error, 'GitLab readiness check failed before ttyd glab auth setup')
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
    'GitLab OAuth token request for ttyd glab auth setup'
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
    'GitLab lambda user lookup for ttyd glab auth setup'
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
      'GitLab lambda user creation for ttyd glab auth setup'
    )

    users = runGitlabApiJson(
      {
        method: 'GET',
        url: `${baseUrl}/api/v4/users?username=${encodeURIComponent(lambdaUser)}`,
        headers: [`Authorization: Bearer ${rootToken}`]
      },
      'GitLab lambda user re-lookup for ttyd glab auth setup'
    )
  }

  const lambdaData = Array.isArray(users) ? users[0] : null
  if (!lambdaData || !lambdaData.id) {
    throw new Error(`Unable to resolve lambda user ID from GitLab response: ${JSON.stringify(users)}`)
  }

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
    'GitLab project creation for ttyd glab auth setup'
  )

  const patData = runGitlabApiJson(
    {
      method: 'POST',
      url: `${baseUrl}/api/v4/users/${lambdaData.id}/personal_access_tokens`,
      headers: [`Authorization: Bearer ${rootToken}`],
      jsonBody: {
        name: `ttyd-glab-auth-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        scopes: ['api', 'write_repository']
      }
    },
    'GitLab personal access token creation for ttyd glab auth setup'
  )

  const glabToken = patData.token
  if (!glabToken) {
    throw new Error(`GitLab personal access token missing in response: ${JSON.stringify(patData)}`)
  }

  const networkConnect = runCommandWithResult(
    `docker network connect ${shellEscape(resolveGitLabDockerNetwork())} ${shellEscape(this.ttydContainerName)}`
  )
  if (
    networkConnect.exitCode !== 0 &&
    !/already exists|already connected/i.test(networkConnect.output)
  ) {
    throw new Error(`Failed to connect ttyd container to GitLab network:\n${networkConnect.output}`)
  }

  const setupResult = execInContainerAsUser(this.ttydContainerName, 'bootstrap', [
    'set -eu',
    'export PATH="$HOME/.local/bin:$PATH"',
    `cd ${CONTAINER_WORKDIR}`,
    `git config --global --add safe.directory ${CONTAINER_WORKDIR}`,
    'git config --global user.email "bootstrap@example.com"',
    'git config --global user.name "Bootstrap"',
    'if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then',
    '  git init -q',
    '  git add .',
    '  git commit -q -m "bootstrap init"',
    'fi',
    'if git remote get-url origin >/dev/null 2>&1; then',
    '  git remote remove origin',
    'fi',
    `git remote add origin "http://gitlab/${lambdaUser}/${gitlabProjectName}.git"`,
    'task glab:install',
    'rm -rf ~/.config/glab-cli || true',
    'glab auth login \\',
    '  --hostname gitlab \\',
    `  --token ${shellEscape(glabToken)} \\`,
    '  --api-protocol http \\',
    '  --api-host gitlab:80 \\',
    '  --git-protocol http',
    'if ! grep -Fq \'export PATH="$HOME/.local/bin:$PATH"\' "$HOME/.bashrc"; then',
    '  echo \'export PATH="$HOME/.local/bin:$PATH"\' >> "$HOME/.bashrc"',
    'fi',
    'command -v glab >/dev/null 2>&1'
  ].join('\n'), { timeout: INSTALL_SCRIPT_TIMEOUT })

  if (setupResult.exitCode !== 0) {
    throw new Error(`Failed to configure ttyd workspace GitLab auth:\n${setupResult.output}`)
  }
})

Given('the ttyd glab config contains a failing secondary host', function () { // eslint-disable-line no-undef
  if (!this.ttydContainerName) {
    throw new Error('No ttyd container is running for this scenario.')
  }

  const result = execInContainerAsUser(this.ttydContainerName, 'bootstrap', [
    'set -eu',
    'CONFIG="$HOME/.config/glab-cli/config.yml"',
    'if [ ! -f "$CONFIG" ]; then',
    '  echo "Missing glab config at $CONFIG" >&2',
    '  exit 1',
    'fi',
    'cat > /tmp/inject-broken-host.awk <<\'AWK\'',
    'BEGIN { inserted = 0 }',
    '/^hosts:$/ && inserted == 0 {',
    '  print',
    '  print "    broken.invalid:"',
    '  print "        api_host: broken.invalid"',
    '  print "        api_protocol: https"',
    '  print "        git_protocol: https"',
    '  print "        token: invalid-token"',
    '  print "        user: broken"',
    '  inserted = 1',
    '  next',
    '}',
    '{ print }',
    'END {',
    '  if (inserted == 0) {',
    '    print "hosts:"',
    '    print "    broken.invalid:"',
    '    print "        api_host: broken.invalid"',
    '    print "        api_protocol: https"',
    '    print "        git_protocol: https"',
    '    print "        token: invalid-token"',
    '    print "        user: broken"',
    '  }',
    '}',
    'AWK',
    'awk -f /tmp/inject-broken-host.awk "$CONFIG" > "$CONFIG.tmp"',
    'mv "$CONFIG.tmp" "$CONFIG"',
    'chmod 0600 "$CONFIG"'
  ].join('\n'))

  if (result.exitCode !== 0) {
    throw new Error(`Failed to inject a broken host into glab config:\n${result.output}`)
  }
})

Given('glab is available in the ttyd container shell', function () { // eslint-disable-line no-undef
  if (!this.ttydContainerName) {
    throw new Error('No ttyd container is running for this scenario.')
  }

  const result = execInContainerAsUser(this.ttydContainerName, 'bootstrap', [
    'set -eu',
    'export PATH="$HOME/.local/bin:$PATH"',
    'command -v glab >/dev/null 2>&1',
    'glab --version >/dev/null 2>&1'
  ].join('\n'))

  if (result.exitCode !== 0) {
    throw new Error(`glab is not available in the ttyd container shell:\n${result.output}`)
  }
})

Given('glab host-specific statuses include one healthy and one failing host in ttyd', function () { // eslint-disable-line no-undef
  if (!this.ttydContainerName) {
    throw new Error('No ttyd container is running for this scenario.')
  }

  const result = execInContainerAsUser(this.ttydContainerName, 'bootstrap', [
    'set -eu',
    'export PATH="$HOME/.local/bin:$PATH"',
    'glab auth status --hostname gitlab >/tmp/glab-status-gitlab.log 2>&1',
    'if glab auth status --hostname broken.invalid >/tmp/glab-status-broken.log 2>&1; then',
    '  echo "Expected broken.invalid auth status to fail" >&2',
    '  cat /tmp/glab-status-broken.log >&2',
    '  exit 1',
    'fi'
  ].join('\n'), { timeout: TERMINAL_CMD_TIMEOUT })

  if (result.exitCode !== 0) {
    const logs = execInContainerAsUser(this.ttydContainerName, 'bootstrap', [
      'set +e',
      'echo "--- gitlab status ---"',
      'cat /tmp/glab-status-gitlab.log 2>/dev/null || true',
      'echo "--- broken.invalid status ---"',
      'cat /tmp/glab-status-broken.log 2>/dev/null || true'
    ].join('\n'))
    throw new Error(
      'Expected one healthy host (gitlab) and one failing host (broken.invalid), but check failed.\n' +
      `${result.output}\n${logs.output}`
    )
  }
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
  I.amOnPage(`http://${this.ttydContainerName}:${ttydPort()}`) // DevSkim: ignore DS162092
  I.waitForElement('.xterm-screen', 10)
  I.wait(3)
})

async function readLastNonEmptyRenderedRow () {
  return I.executeScript(function () {
    const rows = document.querySelectorAll('.xterm-rows > div')
    for (let i = rows.length - 1; i >= 0; i--) {
      const text = rows[i].textContent || ''
      if (text.replace(/\s+$/, '').length > 0) return text
    }
    return ''
  })
}

async function waitForPromptReturn (scenario, command, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let promptSeenSince = null
  let lastLine = ''
  while (Date.now() < deadline) {
    lastLine = await readLastNonEmptyRenderedRow()
    if (SHELL_PROMPT_RE.test(lastLine)) {
      if (promptSeenSince === null) promptSeenSince = Date.now()
      if (Date.now() - promptSeenSince >= PROMPT_STABILITY_MS) return
    } else {
      promptSeenSince = null
    }
    await I.wait(PROMPT_POLL_SECONDS)
  }
  const procCheck = execInContainer(scenario.ttydContainerName, 'ps -ef 2>&1 | head -30')
  throw new Error(
    `Timed out waiting for shell prompt after command "${command}" (${timeoutMs}ms)\n` +
    `--- Last rendered row: ${JSON.stringify(lastLine)}\n` +
    `--- Container processes:\n${procCheck.output.trim()}`
  )
}

async function runTerminalCommandAndWait (scenario, command) {
  I.click('.xterm-screen')
  I.type(command)
  I.pressKey('Enter')
  await I.wait(2)
  await waitForPromptReturn(scenario, command, INSTALL_SCRIPT_TIMEOUT)
  await waitForTerminalSettle()
}

When('I type {string} in the terminal and wait for completion', async function (command) { // eslint-disable-line no-undef
  await runTerminalCommandAndWait(this, command)
})

When('I type {string} in the terminal', async function (command) { // eslint-disable-line no-undef
  I.click('.xterm-screen')
  I.type(command)
  I.pressKey('Enter')
  await waitForTerminalSettle()
})

When('I run a condensed glab auth status report in the terminal and wait for completion', async function () { // eslint-disable-line no-undef
  await runTerminalCommandAndWait(this, COMPACT_GLAB_AUTH_STATUS_COMMAND)
})

When('I run a condensed task glab auth status check in the terminal and wait for completion', async function () { // eslint-disable-line no-undef
  await runTerminalCommandAndWait(this, COMPACT_TASK_GLAB_AUTH_STATUS_COMMAND)
})

When('I run a condensed task glab auth command in the terminal and wait for completion', async function () { // eslint-disable-line no-undef
  await runTerminalCommandAndWait(this, COMPACT_TASK_GLAB_AUTH_COMMAND)
})

Then('task glab auth status succeeds in ttyd', function () { // eslint-disable-line no-undef
  if (!this.ttydContainerName) {
    throw new Error('No ttyd container is running for this scenario.')
  }

  const result = execInContainerAsUser(this.ttydContainerName, 'bootstrap', [
    'set -eu',
    'export PATH="$HOME/.local/bin:$PATH"',
    `cd ${CONTAINER_WORKDIR}`,
    'task glab:auth:status > /tmp/task-glab-auth-status-check.log 2>&1'
  ].join('\n'), { timeout: TERMINAL_CMD_TIMEOUT })

  if (result.exitCode !== 0) {
    const logs = execInContainerAsUser(
      this.ttydContainerName,
      'bootstrap',
      'cat /tmp/task-glab-auth-status-check.log 2>&1 || true'
    )
    throw new Error(`task glab:auth:status failed unexpectedly in ttyd:\n${logs.output}`)
  }
})

Then('the terminal should contain {string}', async function (expectedText) { // eslint-disable-line no-undef
  await waitForTerminalSettle()
  const terminalText = await I.executeScript(function () {
    const screen = document.querySelector('.xterm-screen')
    return screen ? (screen.textContent || '') : ''
  })

  if (!terminalText || !terminalText.includes(expectedText)) {
    throw new Error(
      `Expected terminal output to contain "${expectedText}" but it was not found.\n` +
      `Terminal content:\n${terminalText || '<empty>'}`
    )
  }
})

const COMPACT_CAPTURE_ID = '__ttyd_compact_capture__'

async function buildCompactTerminalCapture (captureId, patternSources) {
  return I.executeScript(function (args) {
    const id = args.id
    const sources = args.sources
    const patterns = sources.map(function (src) { return new RegExp(src) })
    const screen = document.querySelector('.xterm-screen')
    if (!screen) return { kept: 0, error: 'no-xterm-screen' }

    const screenStyles = window.getComputedStyle(screen)

    function resolveOpaqueBackground () {
      const candidates = [
        document.querySelector('.xterm-viewport'),
        document.querySelector('.terminal'),
        document.querySelector('.xterm'),
        document.body,
        document.documentElement
      ]
      for (let i = 0; i < candidates.length; i++) {
        const el = candidates[i]
        if (!el) continue
        const bg = window.getComputedStyle(el).backgroundColor
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
          return bg
        }
      }
      return 'rgb(0, 0, 0)'
    }

    const opaqueBackground = resolveOpaqueBackground()

    const previous = document.getElementById(id)
    if (previous) previous.remove()

    const rowNodes = Array.from(document.querySelectorAll('.xterm-rows > div'))
    if (rowNodes.length === 0) return { kept: 0, error: 'no-rows' }

    const sampleStyles = window.getComputedStyle(rowNodes[0])
    let rowHeight = parseFloat(sampleStyles.height) || 0
    if (!rowHeight || rowHeight < 4) {
      const sorted = rowNodes
        .map(function (row) { return parseFloat(row.style.top || '0') || 0 })
        .sort(function (a, b) { return a - b })
      for (let i = 1; i < sorted.length; i++) {
        const delta = sorted[i] - sorted[i - 1]
        if (delta > 0) { rowHeight = delta; break }
      }
    }
    if (!rowHeight || rowHeight < 4) rowHeight = 17

    const sortedRows = rowNodes
      .map(function (row) {
        return { row, top: parseFloat(row.style.top || '0') || 0 }
      })
      .sort(function (a, b) { return a.top - b.top })

    // Build a shadow root to fully isolate from xterm CSS rules.
    const host = document.createElement('div')
    host.id = id
    host.style.setProperty('position', 'fixed', 'important')
    host.style.setProperty('top', '0', 'important')
    host.style.setProperty('left', '0', 'important')
    host.style.setProperty('z-index', '2147483647', 'important')
    host.style.setProperty('margin', '0', 'important')
    host.style.setProperty('padding', '0', 'important')
    host.style.setProperty('background', opaqueBackground, 'important')

    const shadow = host.attachShadow({ mode: 'open' })

    const style = document.createElement('style')
    style.textContent = [
      ':host { display: block; margin: 0; padding: 0; }',
      '.wrap {',
      '  display: block;',
      '  margin: 0;',
      '  padding: 0;',
      '  box-sizing: content-box;',
      '  font-family: ' + screenStyles.fontFamily + ';',
      '  font-size: ' + screenStyles.fontSize + ';',
      '  font-weight: ' + screenStyles.fontWeight + ';',
      '  letter-spacing: ' + screenStyles.letterSpacing + ';',
      '  line-height: ' + rowHeight + 'px;',
      '  color: ' + screenStyles.color + ';',
      '  background: ' + opaqueBackground + ';',
      '  white-space: pre;',
      '}',
      '.row {',
      '  display: block;',
      '  position: static;',
      '  margin: 0;',
      '  padding: 0;',
      '  border: 0;',
      '  height: ' + rowHeight + 'px;',
      '  min-height: ' + rowHeight + 'px;',
      '  max-height: ' + rowHeight + 'px;',
      '  line-height: ' + rowHeight + 'px;',
      '  overflow: hidden;',
      '  white-space: pre;',
      '}',
      '.row > span { display: inline; vertical-align: baseline; }'
    ].join('\n')
    shadow.appendChild(style)

    const wrap = document.createElement('div')
    wrap.className = 'wrap'
    shadow.appendChild(wrap)

    let kept = 0
    let maxChars = 0

    sortedRows.forEach(function (entry) {
      const rawText = entry.row.textContent || ''
      const trimmed = rawText.replace(/\s+$/, '')
      if (trimmed === '') return
      if (patterns.some(function (re) { return re.test(trimmed) })) return

      const line = document.createElement('div')
      line.className = 'row'

      // Clone child nodes but stop once we've emitted up to `trimmed.length` chars
      // so trailing whitespace-only spans don't bloat the row width.
      let emitted = 0
      const limit = trimmed.length

      Array.from(entry.row.childNodes).some(function (node) {
        if (emitted >= limit) return true

        if (node.nodeType === 3) {
          const textValue = node.textContent || ''
          const take = Math.min(textValue.length, limit - emitted)
          if (take > 0) {
            line.appendChild(document.createTextNode(textValue.slice(0, take)))
            emitted += take
          }
          return false
        }

        if (node.nodeType !== 1) return false

        const nodeText = node.textContent || ''
        const take = Math.min(nodeText.length, limit - emitted)
        if (take <= 0) return emitted >= limit

        const sourceStyle = window.getComputedStyle(node)
        const span = document.createElement('span')
        span.textContent = nodeText.slice(0, take)
        span.style.setProperty('color', sourceStyle.color, 'important')
        span.style.setProperty('background-color', sourceStyle.backgroundColor, 'important')
        span.style.setProperty('font-weight', sourceStyle.fontWeight, 'important')
        span.style.setProperty('font-style', sourceStyle.fontStyle, 'important')
        span.style.setProperty('text-decoration', sourceStyle.textDecoration, 'important')
        line.appendChild(span)
        emitted += take

        return false
      })

      wrap.appendChild(line)
      kept++

      if (trimmed.length > maxChars) maxChars = trimmed.length
    })

    host.style.setProperty('height', (kept * rowHeight) + 'px', 'important')
    wrap.style.setProperty('display', 'inline-block', 'important')
    wrap.style.setProperty('height', (kept * rowHeight) + 'px', 'important')

    document.body.appendChild(host)

    // Measure natural width after DOM insertion so the host bounds the content tightly.
    const naturalWidth = wrap.getBoundingClientRect().width
    const finalWidth = Math.ceil(naturalWidth) + 2
    host.style.setProperty('width', finalWidth + 'px', 'important')

    return { kept, width: finalWidth, rowHeight, maxChars }
  }, { id: captureId, sources: patternSources })
}

async function removeCompactTerminalCapture (captureId) {
  return I.executeScript(function (id) {
    const el = document.getElementById(id)
    if (el) el.remove()
  }, captureId)
}

Then('the terminal output should visually match {string}', async function (baselineName) { // eslint-disable-line no-undef
  await I.wait(1)
  I.resizeWindow(1920, 1080)
  await I.wait(2)

  // When a scenario calls `the command output is displayed in the browser`,
  // the page is replaced with a <pre> under <body>. Detect that mode and
  // capture the <pre> directly — it is already deterministic.
  const mode = await I.executeScript(function () {
    if (document.querySelector('.xterm-screen')) return 'xterm'
    if (document.querySelector('body > pre')) return 'pre'
    return 'unknown'
  })

  if (mode === 'pre') {
    await I.wait(0.3)
    await I.captureScreenshot(baselineName, 'actual', 'body > pre')
    I.assertVisualMatch(baselineName, { captureActual: false })
    I.resizeWindow(1024, 768)
    await I.wait(1)
    return
  }

  await waitForTerminalSettle()
  await scrollTerminalToBottom()
  await I.wait(0.5)

  const info = await buildCompactTerminalCapture(
    COMPACT_CAPTURE_ID,
    TERMINAL_NOISE_PATTERNS.map(function (re) { return re.source })
  )
  if (!info || !info.kept) {
    await removeCompactTerminalCapture(COMPACT_CAPTURE_ID)
    throw new Error(`Compact terminal capture produced no rows for "${baselineName}" (mode=${mode}, info=${JSON.stringify(info)})`)
  }

  await I.wait(0.2)
  await I.captureScreenshot(baselineName, 'actual', '#' + COMPACT_CAPTURE_ID)
  I.assertVisualMatch(baselineName, { captureActual: false })

  await removeCompactTerminalCapture(COMPACT_CAPTURE_ID)
  I.resizeWindow(1024, 768)
  await I.wait(1)
})

Then('I take a terminal screenshot named {string}', async function (name) { // eslint-disable-line no-undef
  I.wait(1)
  I.saveScreenshot(`${name}.png`)
})

Given('the GitLab test stack is started with docker compose', function () { // eslint-disable-line no-undef
  const result = runCommandWithResult(
    'cd /workspace/project && docker compose up -d codeceptjs --wait',
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
    `cd /workspace/project && docker compose run -d --name ${shellEscape(this.dockerContainerName)} ubuntu`,
    { timeout: GITLAB_STACK_TIMEOUT }
  )
  activeContainers.push(this.dockerContainerName)
})

Given('a fresh Ubuntu docker container is running on the GitLab test network', function () { // eslint-disable-line no-undef
  this.dockerContainerName = containerName()
  this.gitlabDockerNetworkName = GITLAB_DOCKER_NETWORK_ALIAS
  runCommand(
    `cd /workspace/project && docker compose run -d --name ${shellEscape(this.dockerContainerName)} ubuntu`,
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

When('I run {string} from {string} in the ttyd container', function (command, dir) { // eslint-disable-line no-undef
  if (!this.ttydContainerName) {
    throw new Error('No ttyd container is running for this scenario.')
  }
  const result = execInContainerAsUser(
    this.ttydContainerName,
    'bootstrap',
    ['export PATH="$HOME/.local/bin:$PATH"', `cd ${dir}`, command].join('\n'),
    { timeout: INSTALL_SCRIPT_TIMEOUT }
  )
  const commandOutput = result.output || ''
  this.lastCommandOutput = commandOutput
  this.lastCommandExitCode = result.exitCode
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
    if (
      trimmed.startsWith('{"id":') &&
      trimmed.includes('"name_with_namespace"') &&
      trimmed.includes('"default_branch"')
    ) {
      return false
    }

    // Filter timing/package-counter lines (npm / uv / apt / go) that vary
    // between runs — same patterns applied to xterm-mode captures.
    return !TERMINAL_NOISE_PATTERNS.some(function (pattern) {
      return pattern.test(trimmed)
    })
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
