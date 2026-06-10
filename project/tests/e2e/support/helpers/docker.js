const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execSync, spawnSync } = require('child_process')

function ttydPort () {
  // All containers run on the shared `the-devsecops-toolbox` network;
  // the runner reaches ttyd via the spawned container's hostname and
  // its in-container ttyd listen port — no host port mapping required.
  return 7681
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
  // Stream the command's output live to the parent while also capturing
  // it for later assertions. stdout and stderr are captured separately so
  // JSON-parsing callers can read clean stdout, while callers that match
  // on error messages (docker network connect "already connected", …)
  // still have access to stderr via the combined `output` field.
  const stamp = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  const stdoutFile = path.join(os.tmpdir(), `cmd-${stamp}.out`)
  const stderrFile = path.join(os.tmpdir(), `cmd-${stamp}.err`)
  const stdoutFifo = path.join(os.tmpdir(), `cmd-${stamp}.out.fifo`)
  const stderrFifo = path.join(os.tmpdir(), `cmd-${stamp}.err.fifo`)
  // Named pipes + tracked tee PIDs guarantee the capture files are fully
  // flushed before bash exits. Process substitution `>(tee …)` races with
  // spawnSync return: stderr can still be in-flight when Node reads the
  // file, leaving regex checks (e.g. docker network "already connected")
  // against an empty string.
  const wrapped =
    `mkfifo ${shellEscape(stdoutFifo)} ${shellEscape(stderrFifo)}; ` +
    `tee ${shellEscape(stdoutFile)} < ${shellEscape(stdoutFifo)} & TOUT=$!; ` +
    `tee ${shellEscape(stderrFile)} >&2 < ${shellEscape(stderrFifo)} & TERR=$!; ` +
    `( ${command} ) > ${shellEscape(stdoutFifo)} 2> ${shellEscape(stderrFifo)}; ` +
    'rc=$?; ' +
    'wait $TOUT $TERR 2>/dev/null; ' +
    `rm -f ${shellEscape(stdoutFifo)} ${shellEscape(stderrFifo)}; ` +
    'exit $rc'
  const { timeout = 120000, ...rest } = options
  const result = spawnSync('bash', ['-c', wrapped], {
    stdio: ['ignore', 'inherit', 'inherit'],
    timeout,
    ...rest
  })

  const readAndUnlink = function (file) {
    let content = ''
    try { content = fs.readFileSync(file, 'utf8') } catch (_) { /* ignore */ }
    try { fs.unlinkSync(file) } catch (_) { /* ignore */ }
    return content
  }
  const stdout = readAndUnlink(stdoutFile)
  const stderr = readAndUnlink(stderrFile)

  return {
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdout,
    stderr,
    output: `${stdout}${stderr}`
  }
}

function containerName () {
  return `ttyd-bootstrap-${crypto.randomBytes(4).toString('hex')}`
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

function waitForTtyd (container, timeoutMs) {
  const start = Date.now()
  const url = `http://${container}:${ttydPort()}/` // DevSkim: ignore DS162092

  while (Date.now() - start < timeoutMs) {
    try {
      runCommand(`curl -sf ${shellEscape(url)} >/dev/null 2>&1`)
      return true
    } catch (_) {
      execSync('sleep 0.5')
    }
  }

  throw new Error(`ttyd did not become ready at ${url} within ${timeoutMs}ms`)
}

module.exports = {
  ttydPort,
  shellEscape,
  stripAnsiEscapeSequences,
  runCommand,
  runCommandWithResult,
  containerName,
  execInContainer,
  execInContainerAsUser,
  removeContainer,
  waitForTtyd
}
