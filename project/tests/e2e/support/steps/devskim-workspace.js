/* global inject Given Then After */
/**
 * @devskim-workspace: DevSkim scans the same source on a developer's machine
 * as in CI, and still skips the project's own tmp folder.
 *
 * DevSkim matches the folders its settings skip against the full path of each
 * file. `**\/tmp/**` was meant for the project's tmp folder, but MegaLinter
 * mounts the project under /tmp/lint on a developer's machine: the whole
 * project matched, and `task megalinter` passed where CI failed (issue #239).
 * DevSkim also opens all files before analyzing them: 1,500 ordinary files
 * must not exhaust the container's initial limit of 1,024 open files.
 * A generated project holds an http:// address in its source and a copy in
 * its tmp folder. The card is the real `task megalinter` with DevSkim alone;
 * the twin runs `task megalinter:ci` where CI mounts the files, under /builds.
 */
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const { execFileSync, execSync } = require('child_process')
const { renderProject } = require('../helpers/copierRender')
const { openLocalTerminal } = require('../helpers/localTerminal')
const { terminalCard } = require('../terminal/capture')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const { I } = inject()

const TAG = '@devskim-workspace'
// Fixed path: the prompt prints it on every card.
const PROJECT = '/tmp/e2e-devskim-workspace'
const CONFIG = '.config/megalinter/config.yml'
const DEVSKIM = '.config/devskim/config.json'
const SOURCE = 'src/fetch.js'
const SCRATCH = 'tmp/scratch.js'
const MODULES = 'src/modules'
const MODULE_COUNT = 1500
// The project's files get the bare line; the comment after it is for the
// toolbox's own DevSkim scan of this file.
const PROJECT_LINE = "const DATA_URL = 'http://example.org/data.json'\n" // DevSkim: ignore DS137138 -- the insecure address the story scans for
// DevSkim alone, and nothing that reaches the network or prints advice.
const DEVSKIM_ONLY = [
  'ENABLE_LINTERS: [REPOSITORY_DEVSKIM]',
  'PRE_COMMANDS: []',
  'POST_COMMANDS: []',
  'FLAVOR_SUGGESTIONS: false'
]
const REPORT = 'megalinter-reports/megalinter-report.sarif'
// MegaLinter prints DevSkim's whole SARIF report: the card reads the findings
// back from the report the same run wrote, rule and file.
const RUN = `task megalinter > /dev/null 2>&1; echo "exit code $?"; jq -r '.runs[].results[] | .ruleId + " " + .locations[0].physicalLocation.artifactLocation.uri' ${REPORT}`
// One MegaLinter container per run, padded to one width: the masked name must
// leave the wrapped lines where they are.
const CONTAINER = `e2e-devskim-workspace-${String(process.pid).padStart(7, '0')}`

let story = null

After((test) => {
  if (!(test && test.tags && test.tags.includes(TAG))) return
  if (story && story.closeTerminal) story.closeTerminal()
  execSync(`docker rm -f ${CONTAINER} ${CONTAINER}-builds >/dev/null 2>&1 || true`)
  fs.rmSync(PROJECT, { recursive: true, force: true })
  story = null
})

const git = (args) => execSync(`git ${args}`, { cwd: PROJECT, encoding: 'utf8' })

// DevSkim as CI runs it: the project under /builds, the real CI task and the
// project's MegaLinter image. The files are copied in, as
// MegaLinter does: this test runs in a container, so a bind mount would hand
// Docker a folder of the host. Answers the files DevSkim flags.
function flaggedUnderBuilds () {
  const pin = JSON.parse(fs.readFileSync(path.join(PROJECT, '.config/megalinter/package.json'), 'utf8'))
  const image = `ghcr.io/oxsecurity/megalinter:v${pin.dependencies['mega-linter-runner']}`
  const mount = '/builds/group/project'
  const box = `${CONTAINER}-builds`
  const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 1800000, stdio: ['ignore', 'pipe', 'pipe'] })
  docker('run', '-d', '--name', box, '--ulimit', 'nofile=1024:65536', '--entrypoint', 'sleep', image, '600')
  try {
    assert.equal(docker('exec', box, 'sh', '-c', 'ulimit -Sn').trim(), '1024')
    docker('exec', box, 'mkdir', '-p', mount)
    docker('cp', `${PROJECT}/.`, `${box}:${mount}`)
    // Reuse the suite's pinned Task binary without a network installation.
    const taskBinary = fs.realpathSync(execSync('command -v task', { encoding: 'utf8' }).trim())
    docker('cp', taskBinary, `${box}:/usr/local/bin/task`)
    docker('exec', box, 'chmod', '0755', '/usr/local/bin/task')
    // The copied local report must never stand in for the CI task's report.
    docker('exec', box, 'rm', '-rf', `${mount}/megalinter-reports`)
    let status = 0
    let out = ''
    try {
      out = docker('exec', '-w', mount, box, 'task', 'megalinter:ci')
    } catch (error) {
      status = error.status
      out = `${error.stdout || ''}${error.stderr || ''}`
    }
    assert.equal(status, 201, `The CI task must fail on the insecure address:\n${out}`)
    assert.ok(!out.includes('System.Diagnostics.DiagnosticSource'), `DevSkim must finish scanning all source files:\n${out}`)
    const report = JSON.parse(docker('exec', box, 'cat', `${mount}/${REPORT}`))
    const findings = report.runs.flatMap(run => run.results || [])
    assert.ok(findings.some(result => result.ruleId === 'DS137138'), `The CI report must contain the insecure-address finding:\n${out}`)
    return findings.flatMap(result => result.locations.map(location => location.physicalLocation.artifactLocation.uri))
  } finally {
    execSync(`docker rm -f ${box} >/dev/null 2>&1 || true`)
  }
}

storyboardStep(Given, 'a generated project holds 1500 ordinary source files, an http:// address and a copy in its own tmp folder', async () => {
  fs.rmSync(PROJECT, { recursive: true, force: true })
  renderProject({}, { dst: PROJECT })
  for (const file of [SOURCE, SCRATCH]) {
    fs.mkdirSync(path.join(PROJECT, path.dirname(file)), { recursive: true })
    fs.writeFileSync(path.join(PROJECT, file), PROJECT_LINE)
  }
  fs.mkdirSync(path.join(PROJECT, MODULES), { recursive: true })
  for (let index = 0; index < MODULE_COUNT; index++) {
    fs.writeFileSync(path.join(PROJECT, MODULES, `module-${index}.js`), 'module.exports = 1\n')
  }
  assert.equal(fs.readdirSync(path.join(PROJECT, MODULES)).length, MODULE_COUNT)
  fs.appendFileSync(path.join(PROJECT, CONFIG), `\n${DEVSKIM_ONLY.join('\n')}\n`)
  git('init --quiet --initial-branch=main')
  git('config user.email "e2e@test.local" && git config user.name "E2E"')
  // tmp/ is ignored by the project: add the scratch copy all the same, so the
  // scan has it in the tree whatever git ignores.
  git(`add -A && git add -f ${SCRATCH} && git commit --quiet --no-verify -m "feat: fetch the data"`)

  story = { env: { ...process.env, TASK_MEGALINTER_CONTAINER_NAME: CONTAINER } }
  delete story.env.TASK_E2E_UPDATE_BASELINES
  story.closeTerminal = await openLocalTerminal(I, { cwd: PROJECT, env: story.env, port: 7715, height: 1200, width: 1440 })
  const screen = await terminalCard(I, 'devskim-fixture', `find ${MODULES} -type f | wc -l; head -n 1 ${SOURCE} ${SCRATCH} && cat ${DEVSKIM}`)
  for (const said of [String(MODULE_COUNT), `==> ${SOURCE} <==`, `==> ${SCRATCH} <==`, PROJECT_LINE.trim(), '"Globs"']) {
    assert.ok(screen.includes(said), `Expected "${said}" on screen:\n${screen}`)
  }
})

storyboardStep(Then, "on the developer's machine DevSkim flags the address in the source and skips the copy in tmp", async () => {
  const screen = await terminalCard(I, 'devskim-flags-source', RUN, { timeoutMs: 900000 })
  assert.ok(screen.includes(`DS137138 ${SOURCE}`), `DevSkim must flag ${SOURCE} with DS137138 under /tmp/lint:\n${screen}`)
  assert.ok(screen.includes('exit code 201'), `The finding must fail the run:\n${screen}`)
  assert.ok(!screen.includes(SCRATCH), `DevSkim must skip ${SCRATCH}:\n${screen}`)
  // Twin: where CI mounts the project, DevSkim flags the same file and no other.
  assert.deepEqual(flaggedUnderBuilds(), [SOURCE], 'Under /builds, DevSkim must flag the source and skip tmp/ as well')
})
