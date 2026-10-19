/* global inject Given When Then Before After */
const assert = require('assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { Worker, threadId } = require('worker_threads')
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

// A scanner MegaLinter runs, taken from the project's own MegaLinter image, the
// one `task megalinter` starts: the terminal runs the version the project uses.
// Returns the shell environment that finds it first.
function scannerEnv (binary) {
  const directory = '/tmp/e2e-scanners'
  const target = path.join(directory, binary)
  if (!fs.existsSync(target)) {
    const pin = JSON.parse(fs.readFileSync(path.join(state.project, '.config/megalinter/package.json'), 'utf8'))
    const image = `ghcr.io/oxsecurity/megalinter:v${pin.dependencies['mega-linter-runner']}`
    // Two workers may race here: each writes its own file, the rename is atomic.
    const part = `${target}.${process.pid}`
    fs.mkdirSync(directory, { recursive: true })
    execFileSync('sh', ['-c', `docker run --rm --entrypoint cat ${image} /usr/local/bin/${binary} > ${part}`], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 1800000 })
    fs.chmodSync(part, 0o755)
    fs.renameSync(part, target)
  }
  const env = { ...process.env, PATH: `${directory}:${process.env.PATH}` }
  delete env.TASK_E2E_UPDATE_BASELINES
  return env
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
    ['megalinter', `TASK_MEGALINTER_CONTAINER_NAME=ml-osv-${process.pid}-${threadId}-${sequence++}`], { timeout: 300000 })
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

// @grype-excludes: Grype as MegaLinter runs it, the binary of the project's
// MegaLinter image reading the settings file MegaLinter hands it, without the
// folders MegaLinter adds on its own. An API keeps its own lockfile next to
// three folders that hold none of its code, one level below the root: only
// the exclude list Grype reads tells them apart.
const GRYPE_PROJECT = '/tmp/acme-app'
const GRYPE_CONFIG = '.config/grype/config.yml'
const GRYPE_REPORT = '/tmp/grype.json'
const API_LOCK = 'project/api/package-lock.json'
const API_LOCKS = [
  'project/api/.cache/acme/package-lock.json',
  API_LOCK,
  'project/api/vendor/acme/widget/package-lock.json',
  'project/api/venv/lib/acme/package-lock.json'
]
const SKIPPED = /\/(\.cache|vendor|venv)\//
// The JSON goes to stdout, redirected: printing to the terminal itself, Grype
// would first ask the terminal for its colours.
const GRYPE_SCAN = `grype dir:. -q --config ${GRYPE_CONFIG} -o json > ${GRYPE_REPORT} && jq -r '.matches[].artifact.locations[].path' ${GRYPE_REPORT} | sort -u`

storyboardStep(Given, "a generated project's API holds the same vulnerable lockfile in its own folder and in its .cache, vendor and venv folders", async () => {
  removeRendered(GRYPE_PROJECT)
  state.project = renderProject({}, { dst: GRYPE_PROJECT })
  state.dirs.push(state.project, GRYPE_REPORT)
  API_LOCKS.forEach(writeLock)
  state.closeTerminal = await openLocalTerminal(I, { cwd: state.project, env: scannerEnv('grype'), port: 7705, height: 900 })
  const screen = await terminalCard(I, 'grype-lockfiles', 'grep -H -A1 \'"node_modules/lodash"\' $(find project -name package-lock.json | sort)')
  for (const file of API_LOCKS) assert.ok(screen.includes(`${file}-      "version": "4.17.20"`), `${file} must pin lodash 4.17.20:\n${screen}`)
})

storyboardStep(When, "the developer scans the project with Grype's settings, it reports the API's own lockfile only", async () => {
  const screen = await terminalCard(I, 'grype-scan', GRYPE_SCAN)
  const matches = JSON.parse(fs.readFileSync(GRYPE_REPORT, 'utf8')).matches || []
  const reported = [...new Set(matches.flatMap(match => match.artifact.locations.map(location => location.path)))].sort()
  assert.ok(matches.some(match => match.artifact.name === 'lodash' && match.artifact.version === '4.17.20' &&
    match.artifact.locations.some(location => location.path === `/${API_LOCK}`)), `Grype must report lodash 4.17.20 in ${API_LOCK}. It reported: ${reported.join(', ')}`)
  assert.deepEqual(reported.filter(file => SKIPPED.test(file)), [], 'Grype must skip .cache, vendor and venv one level below the root')
  assert.ok(screen.includes(`/${API_LOCK}`) && !SKIPPED.test(screen), `The card must list the API's own lockfile only:\n${screen}`)
})

storyboardStep(Then, "Grype's settings file skips every folder of its list at any depth", async () => {
  const screen = await terminalCard(I, 'grype-settings', `cat ${GRYPE_CONFIG}`)
  const config = fs.readFileSync(path.join(state.project, GRYPE_CONFIG), 'utf8')
  for (const folder of ['.cache', '.git', 'megalinter-reports', 'node_modules', 'vendor', 'venv']) {
    assert.ok(config.includes(`  - "**/${folder}/**"\n`), `${GRYPE_CONFIG} must skip ${folder} at any depth:\n${config}`)
  }
  assert.doesNotMatch(config, /^ {2}- "\.\//m, `No pattern of ${GRYPE_CONFIG} may be anchored at the root`)
  assert.ok(screen.includes('"**/vendor/**"'), `The card must show the exclude list:\n${screen}`)
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

// @lizard-cli-args: the real `task lizard` in a generated project, pointed at
// the developer's own src folder (the framework's own scripts under .config
// would fill the card and move with every toolbox change). Run once off camera
// before each card, as the twin of what the card shows.
const LIZARD_PROJECT = '/tmp/e2e-lizard-cli-args'
const LIZARD_SOURCE = 'src/shipping.py'
const LIZARD_RUN = 'TASK_LIZARD_PATH_TO_ANALYSE=src task lizard'
// The Python and Lizard versions move with each Renovate update.
const LIZARD_MASKS = [[/--python \d+(\.\d+)+/g, '--python <version>'], [/lizard==\d+(\.\d+)+/g, 'lizard==<version>']]

function lizard (...cliArgs) {
  return runTask(LIZARD_PROJECT, ['lizard', 'TASK_LIZARD_PATH_TO_ANALYSE=src', ...cliArgs], { timeout: 600000, colour: '0' })
}

storyboardStep(Given, 'a generated project holds a function with four paths through it', async () => {
  removeRendered(LIZARD_PROJECT)
  state.project = renderProject({}, { dst: LIZARD_PROJECT })
  state.dirs.push(state.project)
  fs.mkdirSync(path.join(state.project, 'src'))
  fs.writeFileSync(path.join(state.project, LIZARD_SOURCE), [
    'def shipping_cost(weight, express):',
    '    if weight <= 0:',
    '        raise ValueError("weight must be positive")',
    '    if express:',
    '        return 15 + weight * 2',
    '    elif weight > 10:',
    '        return 10 + weight',
    '    return 5',
    ''
  ].join('\n'))
  const env = { ...process.env }
  delete env.TASK_E2E_UPDATE_BASELINES
  state.closeTerminal = await openLocalTerminal(I, { cwd: state.project, env, port: 7706 })
  const screen = await terminalCard(I, 'lizard-function', `cat ${LIZARD_SOURCE}`)
  assert.ok(screen.includes('def shipping_cost(weight, express):') && screen.includes('    elif weight > 10:'), `The card must show the function:\n${screen}`)
})

storyboardStep(When, "the developer runs task lizard, the function stays under Lizard's default limit of 15", async () => {
  const { raw, exitCode } = await lizard()
  assert.equal(exitCode, 0, `task lizard must pass under the default limit:\n${raw}`)
  assert.ok(raw.includes('shipping_cost@1-8@src/shipping.py'), `Lizard must read the developer's function:\n${raw}`)
  assert.ok(raw.includes('No thresholds exceeded (cyclomatic_complexity > 15'), `Lizard must keep its default limit of 15:\n${raw}`)
  const screen = await terminalCard(I, 'lizard-default', `${LIZARD_RUN}; echo "exit code: $?"`, { mask: LIZARD_MASKS })
  assert.ok(screen.includes('No thresholds exceeded (cyclomatic_complexity > 15') && screen.includes('exit code: 0'), `The card must show the passing run:\n${screen}`)
})

storyboardStep(Then, 'with --CCN 3 after the two dashes, Lizard flags the function and the run fails', async () => {
  const { raw, exitCode } = await lizard('--', '--CCN', '3')
  assert.notEqual(exitCode, 0, `task lizard -- --CCN 3 must hand the lower limit to Lizard, which fails on a CCN of 4:\n${raw}`)
  const warnings = raw.indexOf('!!!! Warnings (cyclomatic_complexity > 3')
  assert.ok(warnings !== -1 && raw.indexOf('shipping_cost@1-8@src/shipping.py', warnings) !== -1, `Lizard must flag shipping_cost above a CCN of 3:\n${raw}`)
  const screen = await terminalCard(I, 'lizard-ccn-3', `${LIZARD_RUN} -- --CCN 3; echo "exit code: $?"`, { mask: LIZARD_MASKS })
  assert.ok(screen.includes('Warnings (cyclomatic_complexity > 3') && screen.includes('exit code: 201'), `The card must show the flagged run:\n${screen}`)
})

// @trivy-skip-dirs: Trivy as MegaLinter runs it, the binary of the project's
// MegaLinter image reading the settings file MegaLinter hands it, without the
// folders MegaLinter adds on its own. The same lockfile sits at the root and
// under vendor/: only the scan.skip-dirs list Trivy reads tells them apart.
const TRIVY_PROJECT = '/tmp/e2e-trivy-skip-dirs'
const TRIVY_CONFIG = '.config/trivy/config.yml'
const TRIVY_REPORT = '/tmp/trivy.json'
const TRIVY_LOCKS = ['package-lock.json', 'vendor/acme/widget/package-lock.json']
const TRIVY_SCAN = `trivy fs --quiet --scanners vuln --config ${TRIVY_CONFIG} --format json --output ${TRIVY_REPORT} . && jq -r '.Results[] | select(.Vulnerabilities) | .Target' ${TRIVY_REPORT}`

storyboardStep(Given, 'a generated project holds the same vulnerable lockfile at its root and in a library under vendor/', async () => {
  removeRendered(TRIVY_PROJECT)
  state.project = renderProject({}, { dst: TRIVY_PROJECT })
  state.dirs.push(state.project, TRIVY_REPORT)
  TRIVY_LOCKS.forEach(writeLock)
  state.closeTerminal = await openLocalTerminal(I, { cwd: state.project, env: scannerEnv('trivy'), port: 7704, height: 900 })
  const screen = await terminalCard(I, 'trivy-lockfiles', `grep -H -A1 '"node_modules/lodash"' ${TRIVY_LOCKS.join(' ')}`)
  for (const file of TRIVY_LOCKS) assert.ok(screen.includes(`${file}-      "version": "4.17.20"`), `${file} must pin lodash 4.17.20:\n${screen}`)
})

storyboardStep(When, "the developer scans the project with Trivy's settings, it reports the root lockfile and skips vendor/", async () => {
  const screen = await terminalCard(I, 'trivy-scan', TRIVY_SCAN)
  const results = JSON.parse(fs.readFileSync(TRIVY_REPORT, 'utf8')).Results || []
  const read = results.map(result => result.Target).join(', ')
  const own = results.find(result => result.Target === 'package-lock.json')
  assert.ok(own && (own.Vulnerabilities || []).some(found => found.PkgName === 'lodash' && found.InstalledVersion === '4.17.20'),
    `Trivy must report lodash 4.17.20 in the root lockfile. It read: ${read}`)
  assert.ok(!results.some(result => result.Target.startsWith('vendor/')), `Trivy must skip vendor/. It read: ${read}`)
  assert.ok(screen.split('\n').includes('package-lock.json') && !screen.includes('vendor/'), `The card must list the root lockfile only:\n${screen}`)
})

storyboardStep(Then, "Trivy's settings file lists the folders to skip and still points to the file of accepted findings", async () => {
  const screen = await terminalCard(I, 'trivy-settings', `cat ${TRIVY_CONFIG}`)
  const config = fs.readFileSync(path.join(state.project, TRIVY_CONFIG), 'utf8')
  const ignored = fs.readFileSync(path.join(state.project, '.config/trivy/trivyignore.yml'), 'utf8')
  assert.match(config, /^scan:\n {2}skip-dirs:\n(?: {4}- .+\n)* {4}- vendor\n/m, `${TRIVY_CONFIG} must list vendor under scan.skip-dirs:\n${config}`)
  assert.match(config, /^ignorefile: \.config\/trivy\/trivyignore\.yml$/m, `${TRIVY_CONFIG} must still name the file of accepted findings`)
  assert.doesNotMatch(ignored, /^scan:/m, 'trivyignore.yml must hold accepted findings only')
  assert.ok(screen.includes('skip-dirs:'), `The card must show the folder list:\n${screen}`)
})
