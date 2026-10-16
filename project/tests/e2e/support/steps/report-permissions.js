/* global inject Given Then Before After */
// cspell:ignore drwx pwuser rcfile
/**
 * @report-permissions (issue #273): MegaLinter's reports belong to the
 * developer who ran it, and to no one else, whichever way it ran.
 *
 * The cards are a real terminal on the developer's computer: a container of
 * this suite's own image, where an ordinary user, bootstrap, has the project
 * and Docker. A second container, and not this one, because
 * mega-linter-runner hands Docker the project's own path to mount, and Docker
 * looks that path up on its own disk. The computer mounts a folder of the
 * Docker host at that same path, the way a laptop shares one disk with its
 * Docker. Every card is twinned with a check of the same files, made as root
 * so that no file hides from it.
 */
const assert = require('assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { renderProject, removeRendered } = require('../helpers/copierRender')
const { waitForTtyd } = require('../helpers/docker')
const { PS1, TTYD, ensureTtyd } = require('../helpers/localTerminal')
const { openTerminal, terminalCard } = require('../terminal/capture')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const { I } = inject()

const NET = 'the-devsecops-toolbox_the-devsecops-toolbox'
const REPORTS = 'megalinter-reports'
const LIST = `find ${REPORTS} -printf '%M %u %g %p\\n' | sort -k 4`
const SETTINGS = `
# Only yamllint, on the MegaLinter settings, so that a run takes seconds.
ENABLE_LINTERS: [YAML_YAMLLINT]
FILTER_REGEX_INCLUDE: '\\.config/megalinter/'
PRE_COMMANDS: []
`
// The project's folder on the Docker host is unique to the run.
const RUN_MASK = [[/e2e-reports-[0-9a-f]{8}/g, 'e2e-reports-<run>']]

let state = {}

const docker = (args, options = {}) => execFileSync('docker', args, { encoding: 'utf8', stdio: 'pipe', timeout: 300000, ...options })
const asRoot = (...args) => docker(['exec', '-u', '0', '-w', state.dir, state.name, ...args])
const card = (frame, line) => terminalCard(I, frame, line, { mask: RUN_MASK })

Before(() => { state = {} })
After(() => {
  const { name, project } = state
  if (project) removeRendered(project)
  if (!name) return
  try { docker(['rm', '-f', name, `${name}-lint`]) } catch (_) {}
  // MegaLinter wrote some files as root on the Docker host: only a container removes them.
  try { docker(['run', '--rm', '-v', '/tmp:/host', 'alpine', 'rm', '-rf', `/host/${name}`]) } catch (_) {}
})

async function openDevelopersComputer () {
  state.name = `e2e-reports-${crypto.randomBytes(4).toString('hex')}`
  state.dir = `/tmp/${state.name}`
  const image = docker(['inspect', '--format', '{{.Config.Image}}', os.hostname()]).trim()
  docker(['run', '-d', '--name', state.name, '--hostname', 'workspace', '--network', NET,
    '--group-add', String(fs.statSync('/var/run/docker.sock').gid),
    '-v', `${state.dir}:${state.dir}`, '-v', '/var/run/docker.sock:/var/run/docker.sock', image, 'sleep', 'infinity'])
  // The image's ordinary user, uid 1001, takes the name every story's prompt shows.
  asRoot('sh', '-c', 'usermod -l bootstrap pwuser && groupmod -n bootstrap pwuser')
  docker(['cp', `${state.project}/.`, `${state.name}:${state.dir}`])
  asRoot('chown', '-R', 'bootstrap:bootstrap', state.dir)
  ensureTtyd()
  docker(['cp', TTYD, `${state.name}:/usr/local/bin/ttyd`])
  const rc = `PS1='${PS1}'\nexport FORCE_COLOR=1 TASK_MEGALINTER_CONTAINER_NAME=${state.name}-lint\ncd ${state.dir}\n`
  docker(['exec', '-i', '-u', 'bootstrap', state.name, 'sh', '-c', 'cat > /tmp/bashrc'], { input: rc })
  docker(['exec', '-d', '-u', 'bootstrap', state.name, 'ttyd', '-p', '7681', '-W', '-t', 'scrollback=5000',
    '-t', 'rendererType=dom', '--', 'bash', '--rcfile', '/tmp/bashrc'])
  waitForTtyd(state.name, 30000)
  await openTerminal(I, state.name)
}

// The twin of a listing card: every file and folder MegaLinter left, seen as
// root, belongs to bootstrap and gives no right to anyone else.
function assertReportsPrivate (screen) {
  assert.ok(screen.includes(`drwx------ bootstrap bootstrap ${REPORTS}`), screen)
  const files = asRoot('find', REPORTS).trim().split('\n')
  assert.ok(files.length > 3, `MegaLinter must leave its reports:\n${files.join('\n')}`)
  const loose = asRoot('find', REPORTS, '(', '!', '-user', 'bootstrap', '-o', '!', '-group', 'bootstrap', '-o', '-perm', '/077', ')').trim()
  assert.equal(loose, '', `Only bootstrap may own, read or change the reports:\n${asRoot('sh', '-c', LIST)}`)
}

// Off camera: a freshly generated project with its settings committed, copied
// to the developer's computer, and a terminal on it.
storyboardStep(Given, 'a generated project where MegaLinter runs only yamllint on its own settings', async () => {
  state.project = renderProject()
  fs.appendFileSync(path.join(state.project, '.config/megalinter/config.yml'), SETTINGS)
  execFileSync('sh', ['-c', 'git init -q && git add -A && git -c user.email=e2e@test.local -c user.name=E2E commit -qm "chore: initial render"'],
    { cwd: state.project, stdio: 'pipe' })
  await openDevelopersComputer()
  const screen = await card('yamllint-only-project', `whoami && tail -n 4 .config/megalinter/config.yml && ls ${REPORTS}`)
  assert.match(screen, /^bootstrap$/m)
  assert.ok(screen.includes('ENABLE_LINTERS: [YAML_YAMLLINT]'), screen)
  assert.ok(screen.includes(`cannot access '${REPORTS}'`), screen)
})

storyboardStep(Then, 'task megalinter:npx leaves reports only the developer can read or change', async () => {
  const screen = await card('npx-reports-private', `task megalinter:npx 2>&1 | tail -n 3; ${LIST}`)
  assert.ok(screen.includes('MegaLinter (npx) analysis completed successfully.'), screen)
  assertReportsPrivate(screen)
})

storyboardStep(Then, 'the developer can delete those reports without administrator rights', async () => {
  const screen = await card('reports-deleted', `rm -r ${REPORTS} && ls ${REPORTS}`)
  assert.ok(!screen.includes('Permission denied'), screen)
  assert.ok(screen.includes(`cannot access '${REPORTS}'`), screen)
  assert.throws(() => asRoot('test', '-e', REPORTS), 'The reports must be gone')
})

storyboardStep(Then, 'task megalinter leaves its reports to the developer alone too', async () => {
  const screen = await card('docker-reports-private', `task megalinter 2>&1 | tail -n 5; ${LIST}`)
  assert.ok(screen.includes('All files correctly linted with megalinter!'), screen)
  assertReportsPrivate(screen)
})
