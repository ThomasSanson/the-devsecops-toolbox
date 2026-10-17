/* global inject After Given Then */
/**
 * @dictionary-timeout (issue #47): before its checks, MegaLinter installs the
 * CSpell dictionaries with npm. npm waits five minutes for a registry that
 * does not answer and tries each of the five dictionaries three times, so a
 * stalled registry held the lint job for more than an hour.
 *
 * The cards are a real terminal in this suite's own container, on a freshly
 * generated project. The registry is a test server that accepts connections
 * and never answers. It runs on Docker's default network, where task
 * megalinter starts MegaLinter, so its address changes with every run.
 */
const assert = require('assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { renderProject, removeRendered } = require('../helpers/copierRender')
const { openLocalTerminal } = require('../helpers/localTerminal')
const { terminalCard } = require('../terminal/capture')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const { I } = inject()

const TAG = '@dictionary-timeout'
const PROJECT = '/tmp/e2e-dictionary-timeout'
const PORT = 4873
const BOUND_SECONDS = 120
const MESSAGE = `npm could not install the CSpell dictionaries within ${BOUND_SECONDS} seconds.`
// Room for MegaLinter to start, wait out the bound and finish its check; far
// below the hour npm takes on its own.
const LIMIT_MS = 5 * 60 * 1000
// The kernel accepts the connections (up to the backlog); the server never
// reads them and never answers.
const SILENT = `import socket, time
s = socket.socket()
s.bind(("0.0.0.0", ${PORT}))
s.listen(64)
time.sleep(3600)
`
// The twin of "never answers": a request gets no byte back in five seconds.
const PROBE = `import socket, time
for _ in range(30):
    try:
        c = socket.create_connection(("127.0.0.1", ${PORT}), 5)
        break
    except ConnectionRefusedError:
        time.sleep(0.5)
c.sendall(b"GET / HTTP/1.1\\r\\nHost: registry\\r\\n\\r\\n")
c.settimeout(5)
try:
    print(repr(c.recv(1)))
except socket.timeout:
    print("silent")
`
const REGISTRY_MASK = [[/http:\/\/[\d.]+:4873\//g, 'http://<registry>:4873/']]

let story = null
const owns = (test) => Boolean(test && test.tags && test.tags.includes(TAG))
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: 'pipe', timeout: 120000 })

After((test) => {
  if (!owns(test) || !story) return
  if (story.closeTerminal) story.closeTerminal()
  for (const name of [story.lint, story.registry]) {
    try { docker('rm', '-f', name) } catch (_) {}
  }
  removeRendered(PROJECT)
  story = null
})

// Off camera: the project is rendered and committed, and the test server
// starts from the MegaLinter image the project pins.
storyboardStep(Given, 'a generated project whose MegaLinter settings send npm to a registry that never answers', async () => {
  const id = crypto.randomBytes(4).toString('hex')
  story = { registry: `e2e-silent-registry-${id}`, lint: `e2e-dictionary-timeout-${id}` }
  renderProject({}, { dst: PROJECT })
  const version = JSON.parse(fs.readFileSync(path.join(PROJECT, '.config/megalinter/package.json'), 'utf8')).dependencies['mega-linter-runner']
  docker('run', '-d', '--name', story.registry, '--entrypoint', 'python3', `ghcr.io/oxsecurity/megalinter:v${version}`, '-c', SILENT)
  const address = docker('inspect', '-f', '{{.NetworkSettings.Networks.bridge.IPAddress}}', story.registry).trim()
  assert.match(address, /^\d+\.\d+\.\d+\.\d+$/, 'The test server must sit on the network MegaLinter starts on')
  assert.equal(docker('exec', story.registry, 'python3', '-c', PROBE).trim(), 'silent')
  fs.appendFileSync(path.join(PROJECT, '.config/megalinter/config.yml'), [
    '# Only CSpell, on the MegaLinter settings, and a registry that never answers.',
    'ENABLE_LINTERS: [SPELL_CSPELL]',
    "FILTER_REGEX_INCLUDE: '\\.config/megalinter/'",
    `NPM_CONFIG_REGISTRY: http://${address}:${PORT}/`,
    ''
  ].join('\n'))
  execFileSync('sh', ['-c', 'git init -q && git add -A && git -c user.email=e2e@test.local -c user.name=E2E commit -qm "chore: initial render"'],
    { cwd: PROJECT, stdio: 'pipe' })
  story.closeTerminal = await openLocalTerminal(I, {
    cwd: PROJECT, env: { ...process.env, TASK_MEGALINTER_CONTAINER_NAME: story.lint }, port: 7698, height: 600
  })
  const screen = await terminalCard(I, 'registry-never-answers', 'tail -n 4 .config/megalinter/config.yml', { mask: REGISTRY_MASK })
  assert.ok(screen.includes('ENABLE_LINTERS: [SPELL_CSPELL]'), screen)
  assert.ok(screen.includes(`NPM_CONFIG_REGISTRY: http://${address}:${PORT}/`), screen)
})

storyboardStep(Then, 'task megalinter stops the dictionary install after 120 seconds and says why', async () => {
  const started = Date.now()
  let screen
  try {
    screen = await terminalCard(I, 'install-stops-in-time', "task megalinter 2>&1 | sed -n '/^\\[Pre\\] run/,/^$/p'", { timeoutMs: LIMIT_MS })
  } catch (err) {
    if (!/Timed out waiting for shell prompt/.test(err.message)) throw err
    assert.fail(`task megalinter was still running after ${LIMIT_MS / 60000} minutes: nothing bounds the dictionary install.\n${err.message}`)
  }
  const seconds = Math.round((Date.now() - started) / 1000)
  assert.ok(screen.includes(`timeout ${BOUND_SECONDS} npm install -g`), screen)
  assert.ok(screen.includes(MESSAGE), screen)
  assert.ok(seconds >= BOUND_SECONDS, `npm must have waited for the registry until the bound, not stopped for another reason (${seconds} s):\n${screen}`)
})
