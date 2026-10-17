/* global inject Given When Then Before After */
const assert = require('assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { Worker } = require('worker_threads')
const {
  COPIER, prepareVersionedTemplate, renderProject, renderProjectFromTemplate, removeRendered
} = require('../helpers/copierRender')
const { runTask } = require('../helpers/taskProcess')
const { OsvCiEvidence } = require('../helpers/osvCiEvidence')
const { openLocalTerminal } = require('../helpers/localTerminal')
const { terminalCard } = require('../terminal/capture')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const { I, GitLabUserPage } = inject()

const FIXTURES = path.join(__dirname, '../../fixtures/osv-scope')
const OUTPUT = path.join(__dirname, '../../_output')
const BASE_CONFIG = '.config/megalinter/config.base.yml'
const PROJECT_CONFIG = '.config/megalinter/config.yml'
const ANSWERS = '.config/devsecops/.copier-answers.yml'
const REPORTS = 'megalinter-reports/linters_logs'
const ADVISORY = 'GHSA-35jh-r3h4-6jhm'
const PROJECT_LOCKS = [
  'package-lock.json',
  '.config/project-tool/package-lock.json',
  '.config/codeceptjs-extra/package-lock.json',
  'application/.config/codeceptjs/package-lock.json'
]

let state
let sequence = 0

Before(() => { state = { dirs: [] } })
After(async () => {
  const finished = state
  try {
    if (finished.closeTerminal) finished.closeTerminal()
    if (finished.hostCopy) removeHostCopy(finished.hostCopy)
    if (finished.ci) await finished.ci.close()
  } finally { finished.dirs.forEach(removeRendered) }
})

function ciEvidence (name = 'e2e-osv-scope') {
  if (!state.ci) state.ci = new OsvCiEvidence(I, GitLabUserPage, name)
  return state.ci
}

function run (command, args = []) {
  return execFileSync(command, args, {
    cwd: state.project,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 300000,
    env: { ...process.env, TASK_COPIER_COMMAND: COPIER }
  })
}

function writeLock (file) {
  const destination = path.join(state.project, file)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(path.join(FIXTURES, 'vulnerable-lock.json'), destination)
}

// Discover shipped dependency directories so a newly added tool cannot silently
// escape this test. Each receives the same npm fixture, regardless of its language.
function frameworkTools () {
  return fs.readdirSync('/workspace/.config').filter(tool => {
    const directory = path.join('/workspace/.config', tool)
    return fs.statSync(directory).isDirectory() && fs.readdirSync(directory)
      .some(file => /^(package(-lock)?\.json|requirements.*\.txt|.*\.lock|go\.(mod|sum))$/.test(file))
  }).sort()
}

function configureScanner () {
  const projectConfig = fs.readFileSync(path.join(state.project, PROJECT_CONFIG), 'utf8')
  fs.writeFileSync(path.join(state.project, PROJECT_CONFIG), projectConfig + '\n' + [
    'ENABLE_LINTERS: [REPOSITORY_OSV_SCANNER]',
    'PRE_COMMANDS: []',
    'POST_COMMANDS: []',
    'SARIF_REPORTER: false',
    'OUTPUT_DETAIL: detailed',
    'REPOSITORY_OSV_SCANNER_ARGUMENTS: ["--offline"]',
    'REPOSITORY_OSV_SCANNER_PRE_COMMANDS:',
    '  - command: mkdir -p "$HOME/.cache/osv-scanner/npm" && cp .cache/osv-scanner/npm/all.zip "$HOME/.cache/osv-scanner/npm/all.zip"',
    '    cwd: workspace',
    '    continue_if_failed: false',
    ''
  ].join('\n'))
  const database = path.join(state.project, '.cache/osv-scanner/npm/all.zip')
  fs.mkdirSync(path.dirname(database), { recursive: true })
  run('python3', ['-c',
    'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1], "w"); z.write(sys.argv[2], "GHSA-35jh-r3h4-6jhm.json"); z.close()',
    database, path.join(FIXTURES, `${ADVISORY}.json`)])
}

async function localScan () {
  const { raw: output, exitCode } = await runTask(state.project,
    ['megalinter', `TASK_MEGALINTER_CONTAINER_NAME=ml-osv-${process.pid}-${sequence++}`], { timeout: 300000 })
  const file = `${REPORTS}/REPOSITORY_OSV_SCANNER-${exitCode === 0 ? 'SUCCESS' : 'ERROR'}.log`
  assert.ok(fs.existsSync(path.join(state.project, file)), `OSV must run and produce its report:\n${output}`)
  const report = run('cat', [file])
  return { exitCode, output, report, file }
}

// The same scan twice, at the same time: `task megalinter` here, and the
// generated code:megalinter job on GitLab for the last published commit. The
// CI job must read the same files and reach the same verdict.
async function scan () {
  const pipeline = state.ci.run()
  pipeline.catch(() => {}) // awaited below, once the local scan is done
  const result = await localScan()
  await pipeline
  await state.ci.scan(result)
  return result
}

function assertProjectFindings (result) {
  assert.notEqual(result.exitCode, 0, 'Project vulnerabilities must block MegaLinter')
  assert.ok(result.report.includes(ADVISORY), 'OSV must report the real saved advisory')
  for (const file of PROJECT_LOCKS) {
    assert.ok(result.report.includes(`Scanned ${file} file`), `Project dependency must be scanned: ${file}`)
  }
  assertFrameworkLeftToToolbox(result)
}

function assertFrameworkLeftToToolbox (result) {
  for (const tool of state.tools) {
    assert.ok(!result.report.includes(`Scanned .config/${tool}/package-lock.json file`), `Inherited tool must be excluded: ${tool}`)
  }
  assert.ok(result.output.includes('--no-resolve'), 'Project arguments must preserve the inherited arguments')
}

storyboardStep(Given, 'every framework tool in a generated project contains the same vulnerable package', async () => {
  state.template = prepareVersionedTemplate()
  state.dirs.push(state.template)
  state.project = renderProjectFromTemplate(state.template, '1.0.0', { project_enabled: false, ansible_enabled: true })
  state.dirs.push(state.project)
  state.tools = frameworkTools()
  state.base = fs.readFileSync(path.join(state.project, BASE_CONFIG), 'utf8')
  for (const tool of state.tools) {
    const directory = path.join(state.project, '.config', tool)
    for (const file of fs.readdirSync(directory)) {
      if (/^requirements.*\.txt$/.test(file)) {
        // Copier migrations need the actual Copier environment. Its vulnerable
        // fixture lockfile still proves the same ownership boundary.
        if (tool === 'copier') continue
        // Root Task variables read these files even when only MegaLinter runs.
        fs.writeFileSync(path.join(directory, file), '# Dependencies replaced by the OSV fixture lockfile.\n')
      } else if (/^(package-lock\.json|.*\.lock|go\.(mod|sum))$/.test(file)) {
        fs.unlinkSync(path.join(directory, file))
      }
    }
    writeLock(`.config/${tool}/package-lock.json`)
  }
  configureScanner()
  const listing = run('sh', ['-c', 'find .config -name package-lock.json | sort'])
  const lock = run('cat', ['.config/codeceptjs/package-lock.json'])
  assert.ok(state.tools.includes('codeceptjs') && state.tools.includes('commitlint'))
  assert.ok(listing.includes('.config/codeceptjs/package-lock.json') && lock.includes('4.17.20'))
  await ciEvidence().publish(state.project, 'test: vulnerable framework tools')
  await state.ci.fileFrame('framework-lockfiles', '.config/codeceptjs/package-lock.json', '4.17.20')
})

// The toolbox's own configuration scans every tool it ships. Off camera, the
// project's configuration comes back in a commit of its own, so the next
// commit card shows the developer's change alone.
storyboardStep(Then, "the toolbox's OSV scan reports the same vulnerable framework tools", async () => {
  fs.copyFileSync(`/workspace/${BASE_CONFIG}`, path.join(state.project, BASE_CONFIG))
  await state.ci.publish(state.project, "test: use the toolbox's scanner configuration")
  const result = await scan()
  assert.notEqual(result.exitCode, 0, 'The toolbox must block vulnerable framework tools')
  assert.ok(result.report.includes(ADVISORY))
  for (const tool of state.tools) assert.ok(result.report.includes(`Scanned .config/${tool}/package-lock.json file`), `The toolbox must scan ${tool}`)
  await state.ci.osvLogFrame('toolbox-tools-reported', { verdict: ADVISORY })
  fs.writeFileSync(path.join(state.project, BASE_CONFIG), state.base)
  await state.ci.publish(state.project, 'test: restore the project scanner configuration')
})

storyboardStep(When, 'the developer adds vulnerable dependencies in project-owned locations', async () => {
  PROJECT_LOCKS.forEach(writeLock)
  const listing = run('sh', ['-c', "find . -name package-lock.json -not -path './.git/*' -not -path './megalinter-reports/*' | sort"])
  assert.ok(!fs.existsSync(path.join(state.project, 'project')), 'Root dependencies must work with project mode disabled')
  for (const file of PROJECT_LOCKS) assert.ok(listing.includes(file))
  await state.ci.publish(state.project, 'test: add project dependencies')
  await state.ci.commitFrame('project-lockfiles', PROJECT_LOCKS, { change: 'new', text: '4.17.20' })
})

// The update keeps the project's own scanner settings and dependency files,
// and the inherited exclusions of the framework tools.
storyboardStep(When, 'the developer updates the framework through Copier', async () => {
  state.override = fs.readFileSync(path.join(state.project, PROJECT_CONFIG), 'utf8')
  run('git', ['add', '-A'])
  run('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'test: customize project scanners'])
  run('task', ['copier:update', `TASK_COPIER_ANSWER_FILE=${ANSWERS}`,
    'TASK_COPIER_CLI_OPTS=--defaults --skip-tasks --vcs-ref 1.0.1'])
  assert.equal(fs.readFileSync(path.join(state.project, PROJECT_CONFIG), 'utf8'), state.override)
  for (const file of PROJECT_LOCKS) assert.ok(fs.existsSync(path.join(state.project, file)))
  const answers = run('grep', ['^_commit:', ANSWERS])
  const argumentsBlock = run('grep', ['-A', '13', '^REPOSITORY_OSV_SCANNER_ARGUMENTS:', BASE_CONFIG])
  assert.ok(answers.includes('1.0.1') && argumentsBlock.includes('--experimental-exclude=.config/codeceptjs'))
  await state.ci.publish(state.project, 'test: update the framework through Copier')
  await state.ci.commitFrame('copier-keeps-osv-scope', [ANSWERS, '.config/jq/Taskfile.yml'], { height: 800 })
})

storyboardStep(Then, 'OSV reports every project-owned copy of the vulnerable package', async () => {
  const result = await scan()
  assertProjectFindings(result)
  await state.ci.osvLogFrame('project-tools-reported', { verdict: ADVISORY })
})

storyboardStep(When, "the developer removes the vulnerable dependencies from the project's own locations", async () => {
  PROJECT_LOCKS.forEach(file => fs.unlinkSync(path.join(state.project, file)))
  const listing = run('sh', ['-c', 'find .config -name package-lock.json | sort'])
  assert.ok(listing.includes('.config/codeceptjs/package-lock.json'))
  await state.ci.publish(state.project, 'test: remove project dependencies')
  await state.ci.commitFrame('project-lockfiles-removed', PROJECT_LOCKS, { change: 'deleted', text: '4.17.20' })
})

storyboardStep(Then, "the project's OSV scan leaves the framework tools to the toolbox and passes", async () => {
  assert.ok(run('cat', ['.config/codeceptjs/package-lock.json']).includes('4.17.20'), 'The framework tools must still be vulnerable')
  const result = await scan()
  assert.equal(result.exitCode, 0, `Inherited framework tools must not block a generated project:\n${result.report}`)
  assert.ok(/no package sources found/i.test(result.report), 'The report must explain that there is no project dependency to scan')
  assert.ok(result.output.includes('Successfully linted all files without errors'), 'An empty scan must be a clean success, without ignored errors')
  assert.ok(result.report.includes('No issues found'), 'OSV must return its native clean verdict for an empty scan')
  assertFrameworkLeftToToolbox(result)
  await state.ci.osvLogFrame('empty-project-scan', { verdict: 'No issues found' })
})

storyboardStep(Given, 'a task emits real output before failing', async () => {
  state.project = fs.mkdtempSync('/tmp/osv-task-progress-')
  state.dirs.push(state.project)
  const taskfile = "version: '3'\ntasks:\n  probe:\n    silent: true\n    cmds:\n      - printf 'native task output\\n' >&2\n      - exit 7\n"
  fs.writeFileSync(path.join(state.project, 'Taskfile.yml'), taskfile)
  await ciEvidence('e2e-task-progress').publishTask(state.project)
  await state.ci.fileFrame('failing-task', 'Taskfile.yml', 'native task output')
})

// The worker runs the task here first, then in the real CI job. The card is
// that job's log; its twins: every byte the task printed reached the worker,
// the CI worker printed the same bytes and exit code, and the CI trace saved
// before the disposable project goes keeps both, without fixture credentials.
storyboardStep(Then, "the CI job log shows the worker's real task output and keeps the job failed", async () => {
  const progress = []
  const result = await new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('worker_threads')
      const { runTask } = require(workerData.helper)
      runTask(workerData.directory, ['probe'], { timeout: 15000, colour: '0' })
        .then(result => parentPort.postMessage({ type: 'result', result }))
        .catch(error => { throw error })
    `, {
      eval: true,
      workerData: { directory: state.project, helper: require.resolve('../helpers/taskProcess'), workerIndex: 1 }
    })
    worker.on('message', message => {
      if (message.type === 'task-output') progress.push(message.output)
      if (message.type === 'result') resolve(message.result)
    })
    worker.on('error', reject)
    worker.on('exit', code => { if (code !== 0) reject(new Error(`Task worker exited ${code}`)) })
  })
  assert.ok(progress.length > 0, 'The worker monitor must receive actual task output while the task runs')
  assert.equal(progress.join(''), result.raw, 'Every progress message must come from the task output')
  assert.notEqual(result.exitCode, 0, 'Task failures must remain failures')
  assert.ok(result.raw.includes('native task output'))
  assert.ok(result.raw.includes('exit status 7'))
  await state.ci.taskResult(result)
  await state.ci.taskLogFrame('failed-task-progress')

  const evidence = state.ci
  const file = path.join(OUTPUT, 'osv-reports', `ci-${evidence.job.id}-trace.log`)
  const credentials = [...Object.values(evidence.headers), ...Object.values(evidence.rootHeaders)]
  state.ci = null
  await evidence.close()
  assert.equal(fs.existsSync(evidence.directory), false, 'The disposable checkout must be removed')
  assert.ok(fs.existsSync(file), 'The CI job trace must survive project cleanup')
  const trace = fs.readFileSync(file, 'utf8')
  const verdict = `Worker task exit code: ${result.exitCode}`
  assert.ok(trace.includes('native task output'), 'The saved trace must contain the actual task output')
  assert.ok(trace.includes(verdict), 'The saved trace must preserve the failure')
  for (const credential of credentials) assert.ok(!trace.includes(credential), 'Saved diagnostics must redact fixture credentials')
  const output = trace.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z \d{2}[OE] /gm, '').replace(/\r/g, '')
  const start = output.indexOf(evidence.redact(result.raw).replace(/\r/g, '').trim())
  assert.ok(start >= 0 && output.indexOf(verdict, start) >= start, 'The saved trace must preserve the complete task output and verdict together')
})

// The toolbox itself, scanned by its own configuration against the live
// vulnerability database: no exclusion of the tools it ships. OSV runs with
// --no-resolve, so it reads lockfiles and requirements files, never a bare
// package.json: the scanned files are exactly those of the template's tools.
storyboardStep(Then, "the toolbox's own OSV scan reads the lockfile or requirements file of every tool that has one and finds no known vulnerability", async () => {
  state.project = prepareVersionedTemplate()
  state.dirs.push(state.project)
  const base = fs.readFileSync(path.join(state.project, BASE_CONFIG), 'utf8')
  assert.ok(!base.includes('--experimental-exclude=.config/'), 'The toolbox must keep its own tools in the scan')
  fs.appendFileSync(path.join(state.project, PROJECT_CONFIG), '\nENABLE_LINTERS: [REPOSITORY_OSV_SCANNER]\nSARIF_REPORTER: false\nOUTPUT_DETAIL: detailed\n')
  const code = 'const lock = require("./.config/codeceptjs/package-lock.json"); for (const [file, pkg] of Object.entries(lock.packages)) if (/\\/(axios|brace-expansion|fast-uri|ip-address|multer|undici)$/.test(file)) console.log(file + ": " + pkg.version)'
  assert.ok(run('node', ['--eval', code]).includes('node_modules/undici:'))
  await ciEvidence('e2e-framework-dependencies').publish(state.project, 'test: scan the shipped dependencies')
  const result = await scan()
  fs.writeFileSync(path.join(OUTPUT, 'framework-osv.log'), result.report)
  fs.writeFileSync(path.join(OUTPUT, 'framework-megalinter.log'), result.output)
  assert.ok(result.report.includes('Scanned .config/codeceptjs/package-lock.json file'), 'OSV must read the actual shipped lockfile')
  const shipped = fs.readdirSync(path.join(state.project, '.config')).sort().flatMap(tool => {
    const directory = path.join(state.project, '.config', tool)
    if (!fs.statSync(directory).isDirectory()) return []
    return fs.readdirSync(directory).filter(file => /^(package-lock\.json|requirements.*\.txt)$/.test(file)).map(file => `.config/${tool}/${file}`)
  }).sort()
  const scanned = result.report.split('\n').map(line => line.match(/^Scanned (\.config\/\S+) file/)?.[1]).filter(Boolean).sort()
  assert.deepEqual(scanned, shipped, 'OSV must read every lockfile and requirements file the toolbox ships, and nothing else under .config')
  assert.equal(result.exitCode, 0, `The toolbox must fix its dependency vulnerabilities:\n${result.report}`)
  assert.ok(result.report.includes('No issues found'), 'OSV must report its native clean verdict')
  // A Renovate bump changes how many packages a lockfile holds, not what the card shows.
  await state.ci.osvLogFrame('framework-dependencies-clean', { verdict: 'No issues found', masks: [[/found \d+ packages?/, 'found <count> packages']] })
})

// @megalinter-config (issue #268): the project names its own MegaLinter
// settings in TASK_MEGALINTER_CONFIG, and each local MegaLinter task must load
// that file. The cards are a real terminal in this container, which has
// Docker; MegaLinter's own [config] line names the file it loaded, and the
// twin reads the same lines off the screen.
const SETTINGS = 'project/megalinter.yml'
const SETTINGS_BODY = `---
# The project's own MegaLinter settings. The toolbox does not ship this file,
# so a framework update never touches it.
EXTENDS: .config/megalinter/config.yml
# Only ShellCheck, so that a run takes seconds.
ENABLE_LINTERS: [BASH_SHELLCHECK]
# ShellCheck needs none of the spelling dictionaries the toolbox installs first.
PRE_COMMANDS: []
`
const LOADED = `[config] /tmp/lint/${SETTINGS} + Environment variables`
const PNPM = '/tmp/e2e-pnpm'
// The project's folder in the prompt is new each run, and so is a linter's time.
const CARD_MASKS = [[/\/tmp\/e2e-render-[0-9a-f]+/g, '/tmp/<project>'], [/ - \(\d+(\.\d+)?s\)/g, ' - (<duration>)']]
const lintRun = task => `task ${task} 2>&1 | grep -E '\\[config\\]|Linted|linted'`
const megalinterImage = () => 'ghcr.io/oxsecurity/megalinter:v' +
  JSON.parse(fs.readFileSync(path.join(state.project, '.config/megalinter/package.json'), 'utf8')).dependencies['mega-linter-runner']

function assertProjectSettingsLoaded (screen) {
  assert.ok(screen.includes(LOADED), `MegaLinter must load ${SETTINGS}:\n${screen}`)
  assert.deepEqual(screen.match(/Linted \[\w+\] files with \[\w+\]/g), ['Linted [BASH] files with [shellcheck]'],
    `Only the linter ${SETTINGS} enables may run:\n${screen}`)
  assert.ok(screen.includes('All files correctly linted with megalinter!'), screen)
}

// mega-linter-runner asks Docker to mount the project folder by its path, and
// the Docker daemon looks that path up on its own machine, not in this
// container. On a developer's machine the two are one; here the project is
// first copied to the same path on the daemon's side.
function copyToDockerHost () {
  state.hostCopy = { dir: state.project, image: megalinterImage() }
  run('sh', ['-c', `tar -cf - . | docker run --rm -i -v ${state.project}:${state.project} --entrypoint tar ${state.hostCopy.image} -xf - -C ${state.project}`])
}

function removeHostCopy ({ dir, image }) {
  try {
    execFileSync('docker', ['run', '--rm', '-v', `${path.dirname(dir)}:/host`, '--entrypoint', 'rm', image, '-rf', `/host/${path.basename(dir)}`], { stdio: 'pipe', timeout: 120000 })
  } catch (_) {
    // Best-effort cleanup.
  }
}

// Off camera: a freshly generated project, its own settings file and the line
// of .env.dist that names it, committed; then a terminal in that project, with
// a container name of its own for task megalinter and pnpm on its PATH.
storyboardStep(Given, 'the project names its own MegaLinter settings file in TASK_MEGALINTER_CONFIG', async () => {
  state.project = renderProject()
  state.dirs.push(state.project)
  fs.writeFileSync(path.join(state.project, SETTINGS), SETTINGS_BODY)
  fs.appendFileSync(path.join(state.project, '.env.dist'), `TASK_MEGALINTER_CONFIG=${SETTINGS}\n`)
  run('sh', ['-c', 'git init -q && git add -A && git -c user.email=e2e@test.local -c user.name=E2E commit -qm "chore: initial render"'])
  state.env = {
    ...process.env,
    PATH: `${PNPM}:${process.env.PATH}`,
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    COREPACK_DEFAULT_TO_LATEST: '0',
    TASK_MEGALINTER_CONTAINER_NAME: 'megalinter-config-' + crypto.randomBytes(4).toString('hex')
  }
  state.closeTerminal = await openLocalTerminal(I, { cwd: state.project, env: state.env, port: 7695 })
  const screen = await terminalCard(I, 'project-settings-file', `cat ${SETTINGS} && grep TASK_MEGALINTER_CONFIG .env.dist`, { mask: CARD_MASKS })
  assert.ok(screen.includes('ENABLE_LINTERS: [BASH_SHELLCHECK]'), screen)
  assert.ok(screen.includes(`TASK_MEGALINTER_CONFIG=${SETTINGS}`), screen)
})

storyboardStep(Then, "task megalinter loads the project's settings file", async () => {
  assertProjectSettingsLoaded(await terminalCard(I, 'task-megalinter-loads-project-settings', lintRun('megalinter'), { mask: CARD_MASKS }))
})

// Off camera: pnpm, as Node's corepack provides it, and the copy of the project
// on the Docker daemon's side.
storyboardStep(Then, 'task megalinter:pnpm:dlx loads the same settings file', async () => {
  fs.mkdirSync(PNPM, { recursive: true })
  execFileSync('corepack', ['enable', 'pnpm', '--install-directory', PNPM], { env: state.env, stdio: 'pipe' })
  execFileSync(`${PNPM}/pnpm`, ['--version'], { cwd: state.project, env: state.env, stdio: 'pipe', timeout: 120000 })
  copyToDockerHost()
  assertProjectSettingsLoaded(await terminalCard(I, 'pnpm-dlx-loads-project-settings', lintRun('megalinter:pnpm:dlx'), { mask: CARD_MASKS }))
})
