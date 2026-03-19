const crypto = require('crypto')
const { execSync } = require('child_process')

const GITLAB_DOCKER_NETWORK_ALIAS = 'the-devsecops-toolbox'
const GITLAB_READY_POLL_INTERVAL_SECONDS = 2

function dockerHost () {
  const dh = process.env.DOCKER_HOST || ''
  const match = dh.match(/tcp:\/\/([^:]+)/)
  return match ? match[1] : '127.0.0.1'
}

function shellEscape (value) {
  const quote = String.fromCharCode(39)
  const escapedQuote = quote + '"' + quote + '"' + quote

  return quote + String(value).replace(/'/g, escapedQuote) + quote
}

function stripAnsiEscapeSequences (value) {
  const input = String(value || '')
  const escapeChar = String.fromCharCode(27)
  let cleaned = ''

  for (let index = 0; index < input.length; index++) {
    if (input[index] === escapeChar && input[index + 1] === '[') {
      index += 2
      while (index < input.length && !/[A-Za-z]/.test(input[index])) {
        index++
      }
      continue
    }

    cleaned += input[index]
  }

  return cleaned
}

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

function parseJson (raw, context) {
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`Failed to parse JSON for ${context}:\n${raw}`)
  }
}

function buildCurlCommand ({ method = 'GET', url, headers = [], dataUrlencoded = [], jsonBody }) {
  const parts = ['cd project && docker compose exec -T gitlab curl', '-sS', '--fail', '--request', method]

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
  return 'http://gitlab:80'
}

function collectGitlabComposeDiagnostics () {
  const checks = [
    {
      title: 'docker compose ps',
      command: 'cd project && docker compose ps'
    },
    {
      title: 'docker compose logs --tail=200 gitlab',
      command: 'cd project && docker compose logs --tail=200 gitlab'
    }
  ]

  return checks.map(function (check) {
    const result = runCommandWithResult(check.command, { timeout: 180000 })
    const status = result.exitCode === 0 ? 'ok' : `exit ${result.exitCode}`
    const output = (result.output || '').trim() || '<no output>'

    return `--- ${check.title} (${status}) ---\n${output}`
  }).join('\n')
}

function withGitlabDiagnostics (error, context) {
  return new Error(
    `${context}.\n${error.message}\n${collectGitlabComposeDiagnostics()}`
  )
}

function waitForGitlabReady (baseUrl, timeoutMs) {
  const startedAt = Date.now()
  const readyUrl = `${baseUrl}/users/sign_in`
  const probeCommand = 'cd project && docker compose exec -T gitlab curl -sf http://127.0.0.1:80/users/sign_in'
  let lastProbeOutput = ''

  while (Date.now() - startedAt < timeoutMs) {
    const probe = runCommandWithResult(probeCommand, { timeout: 30000 })

    if (probe.exitCode === 0 && /user_login/.test(probe.output || '')) {
      return
    }

    lastProbeOutput = (probe.output || '').trim()
    execSync(`sleep ${GITLAB_READY_POLL_INTERVAL_SECONDS}`)
  }

  const lastOutputMessage = lastProbeOutput ? `Last probe output:\n${lastProbeOutput}\n` : ''
  throw new Error(
    `GitLab did not become ready at ${readyUrl} within ${timeoutMs}ms.\n` +
    `${lastOutputMessage}` +
    `${collectGitlabComposeDiagnostics()}`
  )
}

function runGitlabApiJson (request, context) {
  try {
    return runCurlJson(request, context)
  } catch (error) {
    throw withGitlabDiagnostics(error, `Failed ${context}`)
  }
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

function containerName () {
  return `ttyd-bootstrap-${crypto.randomBytes(4).toString('hex')}`
}

function randomPort () {
  const min = 20000
  const max = 30000

  return min + Math.floor(Math.random() * (max - min))
}

function execInContainer (name, command, { user } = {}) {
  const userFlag = user ? `-u ${shellEscape(user)} ` : ''
  return runCommandWithResult(
    `docker exec ${userFlag}${shellEscape(name)} sh -c ${shellEscape(command)}`
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

function runHostCommandInScenario (scenario, command, options = {}) {
  const result = runCommandWithResult(command, {
    timeout: 300000,
    ...options
  })
  scenario.lastCommandOutput = result.output
  scenario.lastCommandExitCode = result.exitCode
  scenario.dockerOutput += result.output

  return result
}

module.exports = {
  GITLAB_DOCKER_NETWORK_ALIAS,
  dockerHost,
  shellEscape,
  stripAnsiEscapeSequences,
  runCommand,
  runCommandWithResult,
  parseJson,
  buildCurlCommand,
  runCurlJson,
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
}
