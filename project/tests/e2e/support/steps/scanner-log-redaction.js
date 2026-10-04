/* global inject Before After Given When Then */
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawnSync, execFileSync } = require('child_process')
const { renderProject, removeRendered } = require('../helpers/copierRender')
const { stripAnsiEscapeSequences } = require('../helpers/docker')
const { renderPreFrame } = require('../helpers/capturedOutput')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const { I } = inject()

const SECRET = ['Zt7k', 'Q2mV', '9pL4', 'xR8w'].join('')
const TASKS = { full: 'scan-full', staged: 'protect', branch: 'scan-branch' }
let projects = []
let binDir
let blocked

Before(() => {
  projects = []
  binDir = null
  blocked = null
})

After(() => {
  projects.forEach(project => removeRendered(project.dir))
  if (binDir) fs.rmSync(binDir, { recursive: true, force: true })
})

function git (project, ...args) {
  return execFileSync('git', args, { cwd: project.dir, encoding: 'utf8', stdio: 'pipe' })
}

function runTask (project, task) {
  const result = spawnSync('task', [task], {
    cwd: project.dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 300000,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      TASK_BETTERLEAKS_BIN_DIR: binDir,
      TASK_BETTERLEAKS_CONTAINER_NAME: `betterleaks-redaction-${crypto.randomBytes(6).toString('hex')}`
    }
  })
  if (result.error || result.signal || result.status === null) {
    throw new Error(`Scanner did not finish: ${project.mode}/${task}`)
  }
  return { project, exit: result.status, stdout: result.stdout, stderr: result.stderr, raw: result.stdout + result.stderr }
}

function saveOutput (scope, state, result) {
  const dir = path.join(global.output_dir, 'scanner-log-redaction')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${result.project.mode}-${scope}-${state}.log`), result.raw)
  fs.writeFileSync(path.join(dir, `${result.project.mode}-${scope}-${state}.stdout.log`), result.stdout)
  fs.writeFileSync(path.join(dir, `${result.project.mode}-${scope}-${state}.stderr.log`), result.stderr)
}

// Preserve every native line and its colours, stdout followed by stderr.
// Betterleaks writes its findings and final timing on different streams; their
// relative arrival order varies. Each complete stream is kept as an artifact.
// Only identities, paths, dates and timings are normalized for the image.
function display (result) {
  const sgr = new RegExp('(' + String.fromCharCode(27) + '\\[[0-9;]*m)', 'g')
  return result.raw.split(sgr).map((text, index) => {
    if (index % 2) return text
    return text.split(result.project.dir).join('<project>')
      .split(binDir).join('<bin-dir>')
      .replace(/betterleaks-redaction-[0-9a-f]+/g, '<scan-container>')
      .replace(/\b[0-9a-f]{7,64}\b/g, '<sha>')
      .replace(/\d{4}-\d{2}-\d{2}T[^\s]+/g, '<date>')
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?(?:AM|PM)?\b/g, '<time>')
      .replace(/\b(?:\d+(?:\.\d+)?(?:µs|μs|ns|ms|s|m|h))+\b/g, '<duration>')
      .replace(/scanned ~\d+ bytes/g, 'scanned <bytes> bytes')
      .replace(/\((?:\d+(?:\.\d+)? (?:bytes|B|KB|MB))\)/g, '(<size>)')
  }).join('').trimEnd()
}

async function frame (name, results) {
  await renderPreFrame(I, name, results.map(result => `${result.project.mode}: task betterleaks:${TASKS[name.split('-')[0]]}\n${display(result)}`).join('\n\n'), { colour: true, height: 2400 })
}

async function cleanScan (scope) {
  const results = projects.map(project => runTask(project, `betterleaks:${TASKS[scope]}`))
  results.forEach(result => {
    saveOutput(scope, 'clean', result)
    if (result.exit !== 0 || !result.raw.includes('No secrets detected')) {
      throw new Error(`Clean scan must pass: ${result.project.mode}/${scope}`)
    }
  })
  await frame(`${scope}-clean`, results)
}

function scanAllBlocked () {
  blocked = {}
  for (const scope of Object.keys(TASKS)) {
    blocked[scope] = projects.map(project => runTask(project, `betterleaks:${TASKS[scope]}`))
    blocked[scope].forEach(result => saveOutput(scope, 'blocked', result))
  }
  const failures = []
  for (const [scope, results] of Object.entries(blocked)) {
    results.forEach(result => {
      const output = stripAnsiEscapeSequences(result.raw)
      const expectedLine = scope === 'staged' ? 2 : 1
      let assignment = 'password'
      if (scope === 'staged') assignment = 'secondPassword'
      const checks = [
        [result.exit !== 0, 'must fail'],
        [output.includes('Betterleaks detected secrets'), 'must report detection'],
        [output.includes('generic-password'), 'must name the rule'],
        [/path\s*\.+\s*(?:\/path\/)?src\/service\.js/.test(output), 'must name the file'],
        [new RegExp(`│\\s*${expectedLine}\\s*│`).test(output), 'must name the line'],
        [!result.raw.includes(SECRET), 'must redact the detected value'],
        [output.includes(`const ${assignment} = "REDACTED";`), 'must redact the whole value']
      ]
      checks.forEach(([ok, message]) => {
        if (!ok) failures.push(`${result.project.mode}/${scope}: ${message}`)
      })
    })
  }
  if (failures.length) throw new Error(failures.join('\n'))
}

storyboardStep(Given, 'clean framework projects use Docker and binary scanners from their install answers', async () => {
  binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redaction-bin-'))
  const settings = []
  for (const mode of ['docker', 'binary']) {
    const project = { mode, dir: renderProject({ privileged_ci_runners: mode === 'docker' }) }
    projects.push(project)
    const env = fs.readFileSync(path.join(project.dir, '.env.dist'), 'utf8')
    const configuredMode = env.match(/^TASK_BETTERLEAKS_MODE=(.+)$/m)
    if ((configuredMode ? configuredMode[1] : 'docker') !== mode) throw new Error('Install answer must select the scanner')
    fs.mkdirSync(path.join(project.dir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(project.dir, 'src/service.js'), 'const greeting = "hello";\n')
    git(project, 'init', '--quiet', '--initial-branch=main')
    git(project, 'config', 'user.name', 'E2E')
    git(project, 'config', 'user.email', 'e2e@test.local')
    git(project, 'add', '-A')
    git(project, 'commit', '--quiet', '--no-verify', '-m', 'chore: render project')
    git(project, 'update-ref', 'refs/remotes/origin/main', 'main')
    git(project, 'switch', '--quiet', '-c', 'feature/scan')
    fs.appendFileSync(path.join(project.dir, 'src/service.js'), 'const farewell = "goodbye";\n')
    git(project, 'add', 'src/service.js')
    git(project, 'commit', '--quiet', '--no-verify', '-m', 'feat: add greeting')
    fs.appendFileSync(path.join(project.dir, 'src/service.js'), 'const colour = "blue";\n')
    git(project, 'add', 'src/service.js')
    const modeFile = mode === 'binary' ? '.env.dist' : '.config/betterleaks/Taskfile.yml'
    settings.push(`${mode}: ${modeFile}\n` + execFileSync('grep', ['TASK_BETTERLEAKS_MODE', modeFile], { cwd: project.dir, encoding: 'utf8' }) + git(project, 'diff', '--cached', '--', 'src/service.js'))
  }
  const install = runTask(projects[1], 'betterleaks:install')
  if (install.exit !== 0 || !install.raw.includes('Checksum verified')) throw new Error('Real binary install must verify the checksum')
  saveOutput('install', 'clean', install)
  await renderPreFrame(I, 'install-answers', settings.join('\n'), { colour: true })
})

storyboardStep(Then, 'full scans pass on ordinary files in both modes', () => cleanScan('full'))
storyboardStep(Then, 'staged scans pass on ordinary changes in both modes', () => cleanScan('staged'))
storyboardStep(Then, 'branch scans pass on ordinary commits in both modes', () => cleanScan('branch'))

storyboardStep(When, 'a synthetic password is committed and staged in both projects', async () => {
  const diffs = []
  projects.forEach(project => {
    fs.writeFileSync(path.join(project.dir, 'src/service.js'), `const password = "${SECRET}";\n`)
    git(project, 'add', 'src/service.js')
    git(project, 'commit', '--quiet', '--no-verify', '-m', 'test: commit synthetic password')
    fs.appendFileSync(path.join(project.dir, 'src/service.js'), `const secondPassword = "${SECRET}";\n`)
    git(project, 'add', 'src/service.js')
    diffs.push(`${project.mode}:\n` + git(project, 'diff', 'origin/main', '--', 'src/service.js'))
  })
  await renderPreFrame(I, 'synthetic-password', diffs.join('\n'), { colour: true })
})

storyboardStep(Then, 'full scans block the secret and redact its value in both modes', async () => {
  scanAllBlocked()
  await frame('full-blocked', blocked.full)
})
storyboardStep(Then, 'staged scans block the secret and redact its value in both modes', () => frame('staged-blocked', blocked.staged))
storyboardStep(Then, 'branch scans block the secret and redact its value in both modes', () => frame('branch-blocked', blocked.branch))
