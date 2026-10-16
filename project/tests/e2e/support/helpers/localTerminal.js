// cspell:ignore rcfile unref
/**
 * A real terminal (ttyd + bash) inside the suite's OWN container, for the
 * stories whose subject runs here and nowhere else: the nested test engine and
 * the toolbox's local gates (red-is-real, verify). The fresh Ubuntu terminals of
 * the other stories have no test engine, so these stories used to paste the
 * engine's output into a <pre>; this gives them the same terminal card as every
 * other story instead: one line typed on camera, the whole screen captured.
 *
 *   const close = await openLocalTerminal(I, { cwd, env, port: 7690 })
 *   const screen = await terminalCard(I, 'frame', 'cmd-a; cmd-b', { mask: ENGINE_MASKS })
 *   close()   // in the story's After
 *
 * ttyd is not in the suite image. Its static binary is borrowed from the
 * ubuntu test image (project/ubuntu/Dockerfile), which every shard builds.
 */
const fs = require('fs')
const { execSync, spawn } = require('child_process')
const { openTerminal } = require('../terminal/capture')

const TTYD = '/tmp/e2e-ttyd'
// The prompt the terminal engine waits for (SHELL_PROMPT_RE in capture.js), in
// the colours of Ubuntu's own bashrc. A literal `$`: this shell runs as root,
// and `\$` would print `#`.
const PS1 = '\\[\\e[01;32m\\]bootstrap@workspace\\[\\e[00m\\]:\\[\\e[01;34m\\]\\w\\[\\e[00m\\]$ '

// What moves between two runs of the same engine command: durations, the
// engine and browser versions, and the line numbers of Node and of the engine's
// own files in a stack trace (they move with a toolchain upgrade, never with
// the behaviour a card is about).
const ENGINE_MASKS = [
  [/CodeceptJS v[0-9][0-9.]*/g, 'CodeceptJS v<version>'],
  // No leading space: the engine colours "in 42ms" on its own, apart from the
  // space before it.
  [/\bin \d+(\.\d+)?m?s\b/g, 'in <duration>'],
  [/\/\/ \d+(\.\d+)?m?s\b/g, '// <duration>'],
  [/browserVersion: [0-9.]+/g, 'browserVersion: <version>'],
  [/((?:node:internal|node_modules)\/[\w./@-]+):\d+:\d+/g, '$1:<line>']
]

function ensureTtyd () {
  if (fs.existsSync(TTYD)) return
  // Two workers may race here: each writes its own file, the rename is atomic.
  const part = `${TTYD}.${process.pid}`
  execSync(`cd /workspace/project && docker compose run --rm -T --no-deps --entrypoint cat ubuntu /usr/local/bin/ttyd > ${part}`,
    { stdio: ['ignore', 'ignore', 'pipe'], timeout: 120000 })
  fs.chmodSync(part, 0o755)
  fs.renameSync(part, TTYD)
}

/**
 * Serve bash in `cwd` with `env` on `port`, open it in the browser at
 * width x height (capture.js openTerminal), and return the function that stops
 * it. The env is the shell's whole environment: drop the suite's own switches
 * (TASK_E2E_UPDATE_BASELINES...) before passing it, or the nested runs inherit
 * them.
 */
async function openLocalTerminal (I, { cwd, env, port, height = 1200, width = 1440 }) {
  ensureTtyd()
  const rc = `/tmp/e2e-terminal-${port}.bashrc`
  fs.writeFileSync(rc, `PS1='${PS1}'\ncd ${cwd}\n`)
  // `--` ends ttyd's own options: without it, ttyd reads bash's as its own.
  const ttyd = spawn(TTYD, ['-p', String(port), '-W', '-t', 'scrollback=5000', '-t', 'rendererType=dom', '--', 'bash', '--rcfile', rc],
    { cwd, env: { ...env, PAGER: 'cat', GIT_PAGER: 'cat' }, detached: true, stdio: 'ignore' })
  ttyd.unref()
  const close = () => {
    try { process.kill(ttyd.pid) } catch (_) {}
    fs.rmSync(rc, { force: true })
  }
  try {
    const deadline = Date.now() + 15000
    for (;;) {
      try {
        execSync(`curl -sf http://localhost:${port}/ >/dev/null`) // DevSkim: ignore DS162092,DS137138 -- Ephemeral test terminal inside the suite container.
        break
      } catch (_) {
        if (Date.now() > deadline) throw new Error(`ttyd did not answer on port ${port}`)
        execSync('sleep 0.2')
      }
    }
    await openTerminal(I, `http://localhost:${port}`, { height, width }) // DevSkim: ignore DS162092,DS137138 -- Ephemeral test terminal inside the suite container.
  } catch (err) {
    close()
    throw err
  }
  return close
}

module.exports = { ENGINE_MASKS, PS1, TTYD, ensureTtyd, openLocalTerminal }
