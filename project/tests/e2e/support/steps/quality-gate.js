/* global inject Given When Then Before After */
/**
 * Quality-gate storyboard — a freshly generated project passes its OWN linter
 * suite. The generated project ships a ~35-linter MegaLinter and a CI `code`
 * stage that runs it; this story renders a vanilla project and runs that exact
 * suite (`task megalinter`, the command the CI code stage runs) on the untouched
 * scaffold, proving the gate is green out of the box (MegaLinter exits 0) and
 * that the secret + dependency scanners find nothing. No GitLab needed. ONE
 * Gherkin sentence = ONE card = ONE pixel baseline (tolerance: 0); every card
 * twins its terminal frame with an exit-code / verdict check.
 */
const { I } = inject()
const { execSync } = require('child_process')
const fs = require('fs')
const { renderProject, removeRendered } = require('../helpers/copierRender')
const { renderPreFrame, stripAnsi } = require('../helpers/capturedOutput')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const MEGALINTER_TIMEOUT = 900000
const VERDICT_MARKER = 'correctly linted with megalinter'
// The secret + dependency scanners whose green verdict this story asserts.
const SECURITY_LINTERS = ['betterleaks', 'trivy', 'trufflehog', 'grype']

let project
let lintRun
let megalinterSeq = 0

function git (repo, cmd) {
  return execSync(`git -C ${repo} ${cmd}`, { encoding: 'utf8' }).trim()
}

// A vanilla render committed once so MegaLinter (which lists files via git) has a
// clean repo to scan.
function scaffoldCleanProject () {
  const dir = renderProject()
  git(dir, 'init -q --initial-branch=main')
  git(dir, 'config user.email "e2e@test.local"')
  git(dir, 'config user.name "E2E"')
  git(dir, 'config core.hooksPath /dev/null')
  git(dir, 'add -A')
  git(dir, 'commit -q -m "test: pristine render"')
  return dir
}

// Run the project's real linter — `task megalinter`, the exact command the CI
// code stage runs — from inside the render. MegaLinter is a heavy (~multi-GB)
// image; in CI's ephemeral dind a pull occasionally stalls, so retry once (the
// same guard template-matrix uses) — the second attempt finds the image warm.
function runMegalinter (dir) {
  let raw = ''
  let exitCode = 0
  for (let attempt = 1; attempt <= 2; attempt++) {
    const container = `ml-gate-${process.pid}-${megalinterSeq++}`
    exitCode = 0
    try {
      raw = execSync(`FORCE_COLOR=0 task megalinter TASK_MEGALINTER_CONTAINER_NAME=${container} 2>&1`, {
        cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: MEGALINTER_TIMEOUT, maxBuffer: 256 * 1024 * 1024
      })
    } catch (e) {
      raw = (e.stdout || '') + (e.stderr || '')
      exitCode = e.status || 1
    }
    if (stripAnsi(raw).includes(VERDICT_MARKER)) break
  }
  return { raw: stripAnsi(raw), exitCode }
}

// MegaLinter's own per-linter verdict line for each named scanner — the
// rendering-stable "✅ Linted [REPOSITORY] files with [X] successfully" (a linter
// with findings prints ❌/error instead). The volatile elapsed suffix
// "- (0.21s)" is the sole per-run variance, so it is dropped. Returns one entry
// per SECURITY_LINTER, null when the green verdict is absent.
function scannerVerdicts (raw) {
  const lines = raw.split('\n')
  return SECURITY_LINTERS.map(linter => {
    const line = lines.find(l => l.includes(`with [${linter}] successfully`))
    return line ? line.replace(/\s*-\s*\([\d.]+m?s\)\s*$/, '').trim() : null
  })
}

Before(() => {
  project = null
  lintRun = null
})

After(() => {
  if (project) removeRendered(project)
  project = null
})

storyboardStep(Given, 'a freshly generated project, still untouched', async () => {
  project = scaffoldCleanProject()
  const status = git(project, 'status --short')
  const versionFile = fs.readFileSync(`${project}/VERSION`, 'utf8').trim()
  await renderPreFrame(
    I,
    'clean-scaffold',
    `$ git status --short\n${status || '(clean)'}\n\n$ cat VERSION\n${versionFile}`
  )
  // Twin: nothing edited yet (clean tree) and the scaffold starts at 0.1.0.
  if (status !== '') throw new Error(`Expected a clean git tree, got:\n${status}`)
  if (versionFile !== '0.1.0') throw new Error(`Expected VERSION 0.1.0, got ${versionFile}`)
})

storyboardStep(When, 'the developer runs the whole linter suite on it', async () => {
  lintRun = runMegalinter(project)
  const verdict = lintRun.raw.split('\n')
    .filter(l => /Successfully linted all files|correctly linted with megalinter/.test(l))
    .map(l => l.trim())
  await renderPreFrame(I, 'gate-green', `$ task megalinter\n${verdict.join('\n')}`)
  // Twin: the gate is green — MegaLinter exits 0 (it exits non-zero on any
  // blocking failure) and prints its all-green verdict.
  if (lintRun.exitCode !== 0) {
    throw new Error(`Expected task megalinter to exit 0 (gate green), got ${lintRun.exitCode}\n---\n${lintRun.raw.split('\n').slice(-40).join('\n')}\n---`)
  }
  if (!lintRun.raw.includes(VERDICT_MARKER)) {
    throw new Error(`Expected MegaLinter's all-green verdict, got none\n---\n${lintRun.raw.split('\n').slice(-40).join('\n')}\n---`)
  }
})

storyboardStep(Then, 'the secret and dependency scanners all come back clean', async () => {
  const verdicts = scannerVerdicts(lintRun.raw)
  await renderPreFrame(I, 'scanners-clean', `$ task megalinter  (secret + dependency scanners)\n${verdicts.filter(Boolean).join('\n')}`)
  // Twin: every named scanner printed its green "linted ... successfully" verdict
  // (a scanner with findings prints an error line instead).
  SECURITY_LINTERS.forEach((linter, i) => {
    if (!verdicts[i]) {
      throw new Error(`Expected MegaLinter's green verdict for ${linter}, got none\n---\n${lintRun.raw.split('\n').filter(l => l.includes(linter)).join('\n')}\n---`)
    }
  })
})
