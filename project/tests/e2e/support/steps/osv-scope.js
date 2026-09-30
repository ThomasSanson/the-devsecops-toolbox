/* global inject Given When Then Before After */
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const {
  COPIER, prepareVersionedTemplate, renderProjectFromTemplate, removeRendered
} = require('../helpers/copierRender')
const { renderPreFrame } = require('../helpers/capturedOutput')
const { runTask } = require('../helpers/taskProcess')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const { I } = inject()

const FIXTURES = path.join(__dirname, '../../fixtures/osv-scope')
const BASE_CONFIG = '.config/megalinter/config.base.yml'
const PROJECT_CONFIG = '.config/megalinter/config.yml'
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
After(() => { state.dirs.forEach(removeRendered) })

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
    '  - command: mkdir -p "$HOME/.cache/osv-scanner/npm" && cp /tmp/lint/.cache/osv-scanner/npm/all.zip "$HOME/.cache/osv-scanner/npm/all.zip"',
    '    continue_if_failed: false',
    ''
  ].join('\n'))
  const database = path.join(state.project, '.cache/osv-scanner/npm/all.zip')
  fs.mkdirSync(path.dirname(database), { recursive: true })
  run('python3', ['-c',
    'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1], "w"); z.write(sys.argv[2], "GHSA-35jh-r3h4-6jhm.json"); z.close()',
    database, path.join(FIXTURES, `${ADVISORY}.json`)])
}

async function scan () {
  const { raw: output, exitCode } = await runTask(state.project,
    ['megalinter', `TASK_MEGALINTER_CONTAINER_NAME=ml-osv-${process.pid}-${sequence++}`], { timeout: 300000 })
  const file = `${REPORTS}/REPOSITORY_OSV_SCANNER-${exitCode === 0 ? 'SUCCESS' : 'ERROR'}.log`
  assert.ok(fs.existsSync(path.join(state.project, file)), `OSV must run and produce its report:\n${output}`)
  const report = run('cat', [file])
  return { exitCode, output, report, file }
}

async function showReport (name, result) {
  // The scanner's full text report is the proof. Only versions and filesystem
  // walk durations vary between runs; findings and paths remain unmasked.
  const report = result.report
    .replace(/version [0-9.]+/g, 'version <version>')
    .replace(/megalinter\.io\/[0-9.]+\//g, 'megalinter.io/<version>/')
    .replace(/[0-9.]+(?:ns|µs|ms|s) elapsed, [0-9.]+(?:ns|µs|ms|s) wall time/g, '<duration> elapsed, <duration> wall time')
  await renderPreFrame(I, name, `$ cat ${result.file}\n${report}`, { colour: true, height: 1000 })
}

function assertProjectFindings (result) {
  assert.notEqual(result.exitCode, 0, 'Project vulnerabilities must block MegaLinter')
  assert.ok(result.report.includes(ADVISORY), 'OSV must report the real saved advisory')
  for (const file of PROJECT_LOCKS) {
    assert.ok(result.report.includes(`Scanned ${file} file`), `Project dependency must be scanned: ${file}`)
  }
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
  await renderPreFrame(I, 'framework-lockfiles', `$ find .config -name package-lock.json | sort\n${listing}\n$ cat .config/codeceptjs/package-lock.json\n${lock}`)
})

storyboardStep(When, "the generated project's OSV scan leaves inherited tools to the toolbox", async () => {
  const result = await scan()
  assert.equal(result.exitCode, 0, `Inherited framework tools must not block a generated project:\n${result.report}`)
  assert.ok(/no package sources found/i.test(result.report), 'The report must explain that there is no project dependency to scan')
  assert.ok(result.output.includes('Successfully linted all files without errors'), 'An empty scan must be a clean success, without ignored errors')
  assert.ok(result.report.includes('No issues found'), 'OSV must return its native clean verdict for an empty scan')
  await showReport('inherited-tools-excluded', result)
})

storyboardStep(Then, "the toolbox's OSV scan reports the same vulnerable framework tools", async () => {
  fs.copyFileSync(`/workspace/${BASE_CONFIG}`, path.join(state.project, BASE_CONFIG))
  const result = await scan()
  assert.notEqual(result.exitCode, 0, 'The toolbox must block vulnerable framework tools')
  assert.ok(result.report.includes(ADVISORY))
  for (const tool of state.tools) assert.ok(result.report.includes(`Scanned .config/${tool}/package-lock.json file`), `The toolbox must scan ${tool}`)
  await showReport('toolbox-tools-reported', result)
  fs.writeFileSync(path.join(state.project, BASE_CONFIG), state.base)
})

storyboardStep(When, 'the developer adds vulnerable dependencies in project-owned locations', async () => {
  PROJECT_LOCKS.forEach(writeLock)
  const listing = run('sh', ['-c', "find . -name package-lock.json -not -path './.git/*' -not -path './megalinter-reports/*' | sort"])
  assert.ok(!fs.existsSync(path.join(state.project, 'project')), 'Root dependencies must work with project mode disabled')
  await renderPreFrame(I, 'project-lockfiles', `$ find . -name package-lock.json -not -path './.git/*' -not -path './megalinter-reports/*' | sort\n${listing}`)
})

storyboardStep(Then, 'OSV reports every project-owned copy of the vulnerable package', async () => {
  const result = await scan()
  assertProjectFindings(result)
  await showReport('project-tools-reported', result)
})

storyboardStep(When, 'the developer updates the framework through Copier', async () => {
  state.override = fs.readFileSync(path.join(state.project, PROJECT_CONFIG), 'utf8')
  run('git', ['add', '-A'])
  run('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'test: customize project scanners'])
  run('task', ['copier:update', 'TASK_COPIER_ANSWER_FILE=.config/devsecops/.copier-answers.yml',
    'TASK_COPIER_CLI_OPTS=--defaults --skip-tasks --vcs-ref 1.0.1'])
  assert.equal(fs.readFileSync(path.join(state.project, PROJECT_CONFIG), 'utf8'), state.override)
  for (const file of PROJECT_LOCKS) assert.ok(fs.existsSync(path.join(state.project, file)))
  const answers = run('grep', ['^_commit:', '.config/devsecops/.copier-answers.yml'])
  const argumentsBlock = run('grep', ['-A', '13', '^REPOSITORY_OSV_SCANNER_ARGUMENTS:', BASE_CONFIG])
  await renderPreFrame(I, 'copier-keeps-osv-scope', `$ grep '^_commit:' .config/devsecops/.copier-answers.yml\n${answers}\n$ grep -A 13 '^REPOSITORY_OSV_SCANNER_ARGUMENTS:' ${BASE_CONFIG}\n${argumentsBlock}`)
})

storyboardStep(Then, 'OSV keeps the same ownership boundary after the update', async () => {
  const result = await scan()
  assertProjectFindings(result)
  await showReport('updated-project-tools-reported', result)
})

storyboardStep(When, 'the developer removes the project dependency fixtures', async () => {
  PROJECT_LOCKS.forEach(file => fs.unlinkSync(path.join(state.project, file)))
  const listing = run('sh', ['-c', 'find .config -name package-lock.json | sort'])
  await renderPreFrame(I, 'only-framework-lockfiles', `$ find .config -name package-lock.json | sort\n${listing}`)
})

storyboardStep(Then, "the project's empty OSV scan passes with a clear result", async () => {
  const result = await scan()
  assert.equal(result.exitCode, 0, result.report)
  assert.ok(/no package sources found/i.test(result.report))
  assert.ok(result.output.includes('Successfully linted all files without errors'), 'The empty scan must stay a clean success after Copier updates')
  assert.ok(result.report.includes('No issues found'), 'OSV must still return its native clean verdict after Copier updates')
  await showReport('empty-project-scan', result)
})

storyboardStep(Given, "the maintainer checks the toolbox's shipped dependency versions", async () => {
  state.project = prepareVersionedTemplate()
  state.dirs.push(state.project)
  state.base = fs.readFileSync(path.join(state.project, BASE_CONFIG), 'utf8')
  assert.ok(!state.base.includes('--experimental-exclude=.config/'), 'The toolbox must keep its own tools in the scan')
  fs.appendFileSync(path.join(state.project, PROJECT_CONFIG), '\nENABLE_LINTERS: [REPOSITORY_OSV_SCANNER]\nSARIF_REPORTER: false\nOUTPUT_DETAIL: detailed\n')
  const code = 'const lock = require("./.config/codeceptjs/package-lock.json"); for (const [file, pkg] of Object.entries(lock.packages)) if (/\\/(axios|brace-expansion|fast-uri|ip-address|multer|undici)$/.test(file)) console.log(file + ": " + pkg.version)'
  const versions = run('node', ['--eval', code])
  assert.ok(versions.includes('node_modules/undici:'))
  await renderPreFrame(I, 'shipped-dependency-versions', `$ node --eval '${code}'\n${versions}`)
})

storyboardStep(When, "the maintainer uses the toolbox's own scanner configuration", async () => {
  state.scan = await scan()
  fs.writeFileSync(path.join(__dirname, '../../_output/framework-osv.log'), state.scan.report)
  fs.writeFileSync(path.join(__dirname, '../../_output/framework-megalinter.log'), state.scan.output)
  assert.ok(state.scan.report.includes('Scanned .config/codeceptjs/package-lock.json file'), 'OSV must read the actual shipped lockfile')
  await renderPreFrame(I, 'framework-scanner-config', `$ grep -A 2 '^REPOSITORY_OSV_SCANNER_ARGUMENTS:' ${BASE_CONFIG}\n${run('grep', ['-A', '2', '^REPOSITORY_OSV_SCANNER_ARGUMENTS:', BASE_CONFIG])}`)
})

storyboardStep(Then, "the toolbox's dependency scan reports no known vulnerabilities", async () => {
  assert.equal(state.scan.exitCode, 0, `The toolbox must fix its dependency vulnerabilities:\n${state.scan.report}`)
  assert.ok(state.scan.report.includes('No issues found'), 'OSV must report its native clean verdict')
  await showReport('framework-dependencies-clean', state.scan)
})
