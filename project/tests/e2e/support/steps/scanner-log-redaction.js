/* global inject Before After Given When Then */
/**
 * @scanner-log-redaction — the three scans a developer runs (scan-full,
 * protect, scan-branch), in a Docker project and a binary project generated
 * with different install answers. Each card shows both projects side by side,
 * answering the same command. The binary scans run with no reachable Docker
 * daemon, so one that tried to start a container would fail.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawn, spawnSync, execFileSync } = require('child_process')
const { renderProject, removeRendered } = require('../helpers/copierRender')
const { stripAnsiEscapeSequences } = require('../helpers/docker')
const { screenText, maskText, terminalOutputFrame } = require('../helpers/terminalRender')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const { I } = inject()

const SECRET = ['Zt7k', 'Q2mV', '9pL4', 'xR8w'].join('')
const TASKS = { full: 'scan-full', staged: 'protect', branch: 'scan-branch' }
const TITLES = { docker: 'Docker project', binary: 'Binary project' }
const NO_DOCKER = 'unix:///nonexistent/docker.sock'
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
      TASK_BETTERLEAKS_CONTAINER_NAME: `betterleaks-redaction-${crypto.randomBytes(6).toString('hex')}`,
      // The binary mode must never need a container: give it no daemon to reach.
      ...(project.mode === 'binary' ? { DOCKER_HOST: NO_DOCKER } : {})
    }
  })
  if (result.error || result.signal || result.status === null) {
    throw new Error(`Scanner did not finish: ${project.mode}/${task}`)
  }
  const raw = result.stdout + result.stderr
  if (project.mode === 'binary' && (raw.includes(NO_DOCKER) || /\bdocker (run|exec|rm)\b/.test(raw))) {
    throw new Error(`The binary scan reached for Docker: ${project.mode}/${task}\n${raw}`)
  }
  return { project, exit: result.status, stdout: result.stdout, stderr: result.stderr, raw }
}

function saveOutput (scope, state, result) {
  const dir = path.join(global.output_dir, 'scanner-log-redaction')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${result.project.mode}-${scope}-${state}.log`), result.raw)
  fs.writeFileSync(path.join(dir, `${result.project.mode}-${scope}-${state}.stdout.log`), result.stdout)
  fs.writeFileSync(path.join(dir, `${result.project.mode}-${scope}-${state}.stderr.log`), result.stderr)
}

// Every native line and its colours, stdout followed by stderr: betterleaks
// writes its findings and its final timing on different streams, and their
// relative arrival order varies. Each complete stream is kept as an artifact.
// Only identities, paths, dates, timings and the scanner version (Docker
// pulls the latest image, Renovate bumps the pinned binary) are masked.
function display (result) {
  const literal = (text) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
  return maskText(screenText(result.raw), [
    [literal(result.project.dir), '<project>'],
    [literal(binDir), '<bin-dir>'],
    [/betterleaks-redaction-[0-9a-f-]+/g, '<scan-container>'],
    [/\b(betterleaks-container-)[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/g, '$1<id>'],
    [/betterleaks \d+(?:\.\d+)+/g, 'betterleaks <version>'],
    [/\b[0-9a-f]{7,64}\b/g, '<sha>'],
    [/\d{4}-\d{2}-\d{2}T[^\s]+/g, '<date>'],
    [/\b\d{1,2}:\d{2}(?::\d{2})?(?:AM|PM)?\b/g, '<time>'],
    [/\b(?:\d+(?:\.\d+)?(?:µs|μs|ns|ms|s|m|h))+\b/g, '<duration>'],
    [/scanned ~\d+ bytes/g, 'scanned <bytes> bytes'],
    [/\((?:\d+(?:\.\d+)? (?:bytes|B|KB|MB))\)/g, '(<size>)']
  ])
}

// One column per project: each command line, then its output.
async function frame (name, scopes, results) {
  await terminalOutputFrame(I, name, projects.map(project => ({
    title: TITLES[project.mode],
    text: scopes.map(scope => {
      const result = results[scope].find(r => r.project === project)
      return `$ task betterleaks:${TASKS[scope]}\n${display(result)}`
    }).join('\n\n')
  })))
}

function scanAll (scopes, state) {
  const results = {}
  for (const scope of scopes) {
    results[scope] = projects.map(project => runTask(project, `betterleaks:${TASKS[scope]}`))
    results[scope].forEach(result => saveOutput(scope, state, result))
  }
  return results
}

function scanAllBlocked () {
  blocked = scanAll(Object.keys(TASKS), 'blocked')
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

// @concurrent-scans — one project with the default answers, so the Docker
// scanner, and each scan started twice at the same time (issue #243). No
// container name is passed: the Taskfile's own naming is what is on trial.
const VERDICTS = { full: 'in your code!', staged: 'in your staged files!', branch: 'in your branch commits!' }

function scanTogether (project, task) {
  return Promise.all([1, 2].map(() => new Promise((resolve, reject) => {
    const child = spawn('task', [task], { cwd: project.dir, stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', data => { stdout += data })
    child.stderr.on('data', data => { stderr += data })
    child.on('error', reject)
    child.on('close', (exit, signal) => resolve({ project, exit, signal, stdout, stderr, raw: stdout + stderr }))
  })))
}

// Both scans finish with their own verdict on the password, from two
// different containers, and leave neither container behind.
function checkTogether (scope, pair) {
  const outputs = pair.map(result => stripAnsiEscapeSequences(result.raw))
  const names = outputs.map(output => (output.match(/docker run --rm -d --name (\S+)/) || [])[1])
  const failures = []
  pair.forEach((result, i) => [
    [result.exit !== 0 && !result.signal, 'must finish and fail'],
    [outputs[i].includes(`Betterleaks detected secrets ${VERDICTS[scope]}`), 'must block the password'],
    [outputs[i].includes('generic-password'), 'must name the rule'],
    [!result.raw.includes(SECRET), 'must redact the detected value'],
    [names[i] && spawnSync('docker', ['container', 'inspect', names[i]], { stdio: 'ignore' }).status !== 0, 'must remove its own container']
  ].forEach(([ok, message]) => { if (!ok) failures.push(`${scope} scan ${i + 1}: ${message}`) }))
  if (names[0] === names[1]) failures.push(`${scope}: both scans used the container ${names[0]}`)
  if (failures.length) throw new Error(`${failures.join('\n')}\n${outputs.join('\n----\n')}`)
}

storyboardStep(Given, 'a project that scans in Docker holds a synthetic password, committed and staged', async () => {
  binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redaction-bin-'))
  const project = { mode: 'docker', dir: renderProject() }
  projects.push(project)
  if (/^TASK_BETTERLEAKS_MODE=/m.test(fs.readFileSync(path.join(project.dir, '.env.dist'), 'utf8'))) {
    throw new Error('The default answers must keep the Docker scanner')
  }
  git(project, 'init', '--quiet', '--initial-branch=main')
  git(project, 'config', 'user.name', 'E2E')
  git(project, 'config', 'user.email', 'e2e@test.local')
  git(project, 'add', '-A')
  git(project, 'commit', '--quiet', '--no-verify', '-m', 'chore: render project')
  git(project, 'update-ref', 'refs/remotes/origin/main', 'main')
  git(project, 'switch', '--quiet', '-c', 'feature/scan')
  fs.mkdirSync(path.join(project.dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(project.dir, 'src/service.js'), `const password = "${SECRET}";\n`)
  git(project, 'add', 'src/service.js')
  git(project, 'commit', '--quiet', '--no-verify', '-m', 'test: commit synthetic password')
  fs.appendFileSync(path.join(project.dir, 'src/service.js'), `const secondPassword = "${SECRET}";\n`)
  git(project, 'add', 'src/service.js')
  // Off camera, as in the scenario below: a cold machine pulls the image first.
  const taskfile = '.config/betterleaks/Taskfile.yml'
  const image = fs.readFileSync(path.join(project.dir, taskfile), 'utf8').match(/TASK_BETTERLEAKS_IMAGE \| default "([^"]+)"/)[1]
  execFileSync('docker', ['pull', '--quiet', image], { stdio: 'pipe' })
  await terminalOutputFrame(I, 'docker-password',
    `$ grep TASK_BETTERLEAKS_MODE ${taskfile}\n` +
    execFileSync('grep', ['TASK_BETTERLEAKS_MODE', taskfile], { cwd: project.dir, encoding: 'utf8' }) +
    '$ git diff origin/main HEAD -- src/service.js\n' +
    git(project, '-c', 'color.ui=always', 'diff', 'origin/main', 'HEAD', '--', 'src/service.js') +
    '$ git diff --cached -- src/service.js\n' +
    git(project, '-c', 'color.ui=always', 'diff', '--cached', '--', 'src/service.js').trimEnd())
})

storyboardStep(Then, 'two full scans started at the same time both block the password, each from its own container', async () => {
  const pairs = {}
  for (const scope of Object.keys(TASKS)) {
    pairs[scope] = await scanTogether(projects[0], `betterleaks:${TASKS[scope]}`)
    pairs[scope].forEach((result, i) => saveOutput(`${scope}-together-${i + 1}`, 'blocked', result))
    checkTogether(scope, pairs[scope])
  }
  await terminalOutputFrame(I, 'full-together', pairs.full.map((result, i) => ({
    title: `Scan ${i + 1}`,
    text: `$ task betterleaks:scan-full\n${display(result)}`
  })))
})

storyboardStep(Given, 'clean framework projects use Docker and binary scanners from their install answers', async () => {
  binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redaction-bin-'))
  const columns = []
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
    columns.push({
      title: TITLES[mode],
      text: `$ grep TASK_BETTERLEAKS_MODE ${modeFile}\n` +
        execFileSync('grep', ['TASK_BETTERLEAKS_MODE', modeFile], { cwd: project.dir, encoding: 'utf8' }) +
        '$ git diff --cached -- src/service.js\n' + git(project, '-c', 'color.ui=always', 'diff', '--cached', '--', 'src/service.js')
    })
  }
  // The docker project pulls its scanner image on first use. Pull it here, off
  // camera, so the scan cards show the scans, not a download only a cold
  // machine prints.
  const docker = projects.find(project => project.mode === 'docker')
  const taskfile = fs.readFileSync(path.join(docker.dir, '.config/betterleaks/Taskfile.yml'), 'utf8')
  execFileSync('docker', ['pull', '--quiet', taskfile.match(/TASK_BETTERLEAKS_IMAGE \| default "([^"]+)"/)[1]], { stdio: 'pipe' })
  const install = runTask(projects[1], 'betterleaks:install')
  if (install.exit !== 0 || !install.raw.includes('Checksum verified')) throw new Error('Real binary install must verify the checksum')
  saveOutput('install', 'clean', install)
  await terminalOutputFrame(I, 'install-answers', columns.map(c => ({ ...c, text: c.text.trimEnd() })))
})

storyboardStep(Then, 'full, staged and branch scans pass on ordinary work in both modes', async () => {
  const results = scanAll(Object.keys(TASKS), 'clean')
  for (const [scope, list] of Object.entries(results)) {
    list.forEach(result => {
      if (result.exit !== 0 || !result.raw.includes('No secrets detected')) {
        throw new Error(`Clean scan must pass: ${result.project.mode}/${scope}`)
      }
    })
  }
  await frame('clean-scans', Object.keys(TASKS), results)
})

storyboardStep(When, 'a synthetic password is committed and staged in both projects', async () => {
  const columns = projects.map(project => {
    fs.writeFileSync(path.join(project.dir, 'src/service.js'), `const password = "${SECRET}";\n`)
    git(project, 'add', 'src/service.js')
    git(project, 'commit', '--quiet', '--no-verify', '-m', 'test: commit synthetic password')
    fs.appendFileSync(path.join(project.dir, 'src/service.js'), `const secondPassword = "${SECRET}";\n`)
    git(project, 'add', 'src/service.js')
    return {
      title: TITLES[project.mode],
      text: '$ git diff origin/main -- src/service.js\n' +
        git(project, '-c', 'color.ui=always', 'diff', 'origin/main', '--', 'src/service.js').trimEnd()
    }
  })
  await terminalOutputFrame(I, 'synthetic-password', columns)
})

storyboardStep(Then, 'full scans block the secret and redact its value in both modes', async () => {
  scanAllBlocked()
  await frame('full-blocked', ['full'], blocked)
})
storyboardStep(Then, 'staged scans block the secret and redact its value in both modes', () => frame('staged-blocked', ['staged'], blocked))
storyboardStep(Then, 'branch scans block the secret and redact its value in both modes', () => frame('branch-blocked', ['branch'], blocked))

// @vendor-allowlist — one project with the default answers, so the Docker
// scanner: the same made-up password in the project's own code and in a
// library a package manager put under vendor/. betterleaks dir reads both, so
// only the allowlist of .config/betterleaks/config.toml tells them apart.
const OWN_FILE = 'src/mailer.php'
const VENDOR_FILE = 'vendor/acme/mailer/tests/config.php'
const BETTERLEAKS_CONFIG = '.config/betterleaks/config.toml'

storyboardStep(Given, 'a generated project holds the same made-up password in its own src/ and in a library under vendor/', async () => {
  binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redaction-bin-'))
  const project = { mode: 'docker', dir: renderProject() }
  projects.push(project)
  for (const file of [OWN_FILE, VENDOR_FILE]) {
    fs.mkdirSync(path.join(project.dir, path.dirname(file)), { recursive: true })
    fs.writeFileSync(path.join(project.dir, file), `<?php\n$password = "${SECRET}";\n`)
  }
  // Off camera, as in the scenario above: a cold machine pulls the image first.
  const taskfile = fs.readFileSync(path.join(project.dir, '.config/betterleaks/Taskfile.yml'), 'utf8')
  execFileSync('docker', ['pull', '--quiet', taskfile.match(/TASK_BETTERLEAKS_IMAGE \| default "([^"]+)"/)[1]], { stdio: 'pipe' })
  const grep = execFileSync('grep', ['-rn', '--color=always', 'password', 'src', 'vendor'], { cwd: project.dir, encoding: 'utf8' })
  const plain = stripAnsiEscapeSequences(grep)
  if (!plain.includes(`${OWN_FILE}:2:`) || !plain.includes(`${VENDOR_FILE}:2:`)) throw new Error(`Both files must hold the password line:\n${plain}`)
  await terminalOutputFrame(I, 'vendor-files', `$ grep -rn password src vendor\n${screenText(grep)}`)
})

storyboardStep(When, 'the developer runs the full secret scan, it blocks src/mailer.php and skips vendor/', async () => {
  const result = runTask(projects[0], 'betterleaks:scan-full')
  saveOutput('vendor', 'blocked', result)
  const output = stripAnsiEscapeSequences(result.raw)
  const failures = [
    [result.exit !== 0, 'must fail'],
    [new RegExp(`path\\s*\\.+\\s*/path/${OWN_FILE.replace('.', '\\.')}`).test(output), `must name ${OWN_FILE}`],
    [!output.includes('vendor/'), 'must skip vendor/'],
    [/leaks found: 1\b/.test(output), 'must find exactly one leak'],
    [!result.raw.includes(SECRET), 'must redact the detected value']
  ].filter(([ok]) => !ok).map(([, message]) => `scan-full: ${message}`)
  if (failures.length) throw new Error(`${failures.join('\n')}\n${output}`)
  await terminalOutputFrame(I, 'vendor-scan', `$ task betterleaks:scan-full\n${display(result)}`)
})

storyboardStep(Then, 'the scan\'s config lists vendor/ and tells a project allowlist to stand on its own, never to extend it', async () => {
  const config = fs.readFileSync(path.join(projects[0].dir, BETTERLEAKS_CONFIG), 'utf8')
  const allowlist = config.slice(config.indexOf('paths = ['))
  const failures = [
    [/^\s*'''\(\^\|\/\)vendor\/''',?$/m.test(allowlist), 'the allowlist must name vendor/'],
    [config.includes('Never point `[extend] path` at this file'), 'must forbid extending this file'],
    [/TASK_BETTERLEAKS_CONFIG\b/.test(config) && config.includes('REPOSITORY_BETTERLEAKS_CONFIG_FILE'), 'must name both settings a copy is pointed with']
  ].filter(([ok]) => !ok).map(([, message]) => `${BETTERLEAKS_CONFIG}: ${message}`)
  if (failures.length) throw new Error(failures.join('\n'))
  await terminalOutputFrame(I, 'vendor-config', `$ cat ${BETTERLEAKS_CONFIG}\n${config.trimEnd()}`)
})
