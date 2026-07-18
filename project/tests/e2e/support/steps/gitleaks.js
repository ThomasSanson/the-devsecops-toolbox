/* global inject Before After Given When Then */
/**
 * Gitleaks secret-scanning storyboard — the whole security promise as ONE
 * developer journey: an ordinary branch stays green, a committed secret gets
 * blocked and named, a secret kept out of git's view via .gitignore never
 * reaches the scanner. ONE Gherkin sentence = ONE storyboard card = ONE
 * pixel baseline, asserted inside the step (tolerance: 0); every verdict
 * card twins its <pre> frame with a programmatic assert of the same fact
 * (exit code / captured output).
 *
 * The gitleaks Taskfile uses the docker run/cp/exec pattern (no bind mounts),
 * so the scan works from inside the codeceptjs runner through the mounted
 * docker socket. The container name is randomized per scan because the
 * Taskfile default (gitleaks-container) would collide across parallel
 * workers. Three situations share the scenario, each on its OWN fresh
 * rendered project/branch (renderProject + git init): scan-branch scans the
 * WHOLE branch history since main, so a later commit must never bleed into
 * an earlier verdict.
 */
const { I } = inject()
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { renderProject, removeRendered } = require('../helpers/copierRender')
const { stripAnsiEscapeSequences } = require('../helpers/docker')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const { renderPreFrame } = require('../helpers/capturedOutput')

const PRIVATE_KEY_HEADER_PARTS = ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----']
const PRIVATE_KEY_FOOTER_PARTS = ['-----END', 'RSA', 'PRIVATE', 'KEY-----']
const TEST_PRIVATE_KEY_SECRET = [
  PRIVATE_KEY_HEADER_PARTS.join(' '),
  'MIIEpAIBAAKCAQEA0testsecretfortemplategitleakstestingonly0000000000',
  PRIVATE_KEY_FOOTER_PARTS.join(' '),
  ''
].join('\n')

// The task's own contract lines — the only deterministic part of the output
// (findings/timings in between carry commit dates and fingerprints and are
// asserted separately by the string checks). The scan-range SHA is masked.
const VERDICT_RES = [
  /^🔍 Scanning commits from /,
  /^🎉 No secrets detected in branch commits\.$/,
  /^❌ Gitleaks detected secrets in your branch commits!$/,
  /^⚠️ {2}Please remove any secrets from the commits\.$/
]

let projectDir = null
let scanResult = null
let cleanupDirs = []
let gitleaksContainer = null

Before(() => {
  projectDir = null
  scanResult = null
  cleanupDirs = []
  gitleaksContainer = null
})

After(() => {
  cleanupDirs.forEach(removeRendered)
  cleanupDirs = []
  if (gitleaksContainer) {
    try {
      execSync(`docker rm -f ${gitleaksContainer}`, { stdio: 'pipe' })
    } catch (_) {
      // Already removed by the Taskfile defer.
    }
    gitleaksContainer = null
  }
})

function git (cmd) {
  return execSync(`git ${cmd}`, { cwd: projectDir, encoding: 'utf8', stdio: 'pipe' })
}

// A fresh rendered project on its own feature branch — each situation in the
// journey gets one, so a later commit never bleeds into an earlier scan's
// branch history.
function newProject () {
  projectDir = renderProject()
  cleanupDirs.push(projectDir)
  git('init --quiet --initial-branch=main')
  git('config user.email "e2e@test.local"')
  git('config user.name "E2E"')
  git('add -A')
  git('commit --quiet --no-verify -m "chore: initial render"')
  // scan-branch diffs against origin/main; create the remote-tracking ref
  // locally so the scan range (merge-base origin/main..HEAD) is well-defined.
  git('update-ref refs/remotes/origin/main main')
  git('checkout --quiet -b feature/scan')
}

function runScan () {
  gitleaksContainer = `gitleaks-e2e-${crypto.randomBytes(4).toString('hex')}`
  const env = {
    ...process.env,
    TASK_GITLEAKS_CONTAINER_NAME: gitleaksContainer
  }
  try {
    const output = execSync('task gitleaks:scan-branch 2>&1', {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 300000,
      env
    })
    scanResult = { exitCode: 0, output }
  } catch (error) {
    scanResult = {
      exitCode: typeof error.status === 'number' ? error.status : 1,
      output: `${error.stdout || ''}${error.stderr || ''}`
    }
  }
  return scanResult
}

function assertContains (output, expected) {
  const cleaned = stripAnsiEscapeSequences(output)
  if (!cleaned.includes(expected)) {
    throw new Error(`Expected gitleaks output to contain "${expected}"\n${cleaned}`)
  }
}

function verdictText (output) {
  const lines = stripAnsiEscapeSequences(output)
    .split('\n')
    .map(line => line.trim())
    .filter(line => VERDICT_RES.some(re => re.test(line)))
    .map(line => line.replace(/[0-9a-f]{7,40}/g, '<sha>'))
  if (lines.length === 0) {
    throw new Error(`No gitleaks verdict lines found in output:\n${output}`)
  }
  return lines.join('\n')
}

// ============================================
// Movement 1 — an ordinary branch stays green
// ============================================

storyboardStep(Given, "a project protected by the framework's secret scanner starts on a clean feature branch", {
  note: 'A freshly rendered project, committed once and checked out on its own feature branch: nothing to report yet.',
  copy: 'git status'
}, async () => {
  newProject()
  const status = git('status')
  await renderPreFrame(I, 'stage-clean-branch', status.trimEnd())
})

storyboardStep(When, 'the developer commits ordinary tracked, untracked and ignored files', {
  note: 'Ordinary work: one file gets committed, another sits in the project without being committed, and a third is listed in .gitignore so git skips it. The scanner must leave all three alone.',
  copy: 'git status --short --ignored'
}, async () => {
  fs.writeFileSync(path.join(projectDir, 'tracked.txt'), 'tracked file\n')
  git('add tracked.txt')
  git('commit --quiet --no-verify -m "test: add tracked fixture"')
  fs.writeFileSync(path.join(projectDir, 'untracked.txt'), 'untracked file\n')
  fs.appendFileSync(path.join(projectDir, '.gitignore'), '\nignored.secret\nignored-dir/\n')
  fs.writeFileSync(path.join(projectDir, 'ignored.secret'), 'ignored secret\n')
  fs.mkdirSync(path.join(projectDir, 'ignored-dir'), { recursive: true })
  fs.writeFileSync(path.join(projectDir, 'ignored-dir', 'inside.txt'), 'ignored nested file\n')
  const status = git('status --short --ignored')
  await renderPreFrame(I, 'ordinary-work-status', status.trimEnd())
})

storyboardStep(Then, 'the scan finds nothing to report', {
  note: 'scan-branch runs clean and prints "No secrets detected in branch commits."',
  copy: 'task gitleaks:scan-branch'
}, async () => {
  const res = runScan()
  if (res.exitCode !== 0) {
    throw new Error(`Expected gitleaks scan-branch to succeed, exit=${res.exitCode}\n${res.output}`)
  }
  assertContains(res.output, 'No secrets detected in branch commits.')
  await renderPreFrame(I, 'verdict-clean', verdictText(res.output))
})

// ============================================
// Movement 2 — a committed secret gets blocked
// ============================================

storyboardStep(When, 'the developer accidentally commits a private key to the branch', {
  note: 'A fresh project (its own branch history): a fake RSA private key lands in a tracked file and gets committed like any other change.',
  copy: 'cat tracked-secret.pem'
}, async () => {
  newProject()
  fs.writeFileSync(path.join(projectDir, 'tracked-secret.pem'), TEST_PRIVATE_KEY_SECRET)
  git('add tracked-secret.pem')
  git('commit --quiet --no-verify -m "test: add tracked secret fixture"')
  const content = fs.readFileSync(path.join(projectDir, 'tracked-secret.pem'), 'utf8')
  await renderPreFrame(I, 'secret-committed', content.trimEnd())
})

storyboardStep(Then, 'the scan blocks it and names the leak', {
  note: 'scan-branch fails and prints "Gitleaks detected secrets in your branch commits!"',
  copy: 'task gitleaks:scan-branch'
}, async () => {
  const res = runScan()
  if (res.exitCode === 0) {
    throw new Error(`Expected gitleaks scan-branch to fail, but it succeeded\n${res.output}`)
  }
  assertContains(res.output, 'Gitleaks detected secrets in your branch commits!')
  await renderPreFrame(I, 'verdict-blocked', verdictText(res.output))
})

// ============================================
// Movement 3 — a gitignored secret never reaches the scanner
// ============================================

storyboardStep(When, 'the developer keeps a second secret out of the scan by gitignoring the file it lives in', {
  note: 'A fresh project again: the secret file is listed in .gitignore before it is ever committed, so the scanner never even looks at it.',
  copy: 'git diff -- .gitignore'
}, async () => {
  newProject()
  fs.appendFileSync(path.join(projectDir, '.gitignore'), '\nignored-secret.pem\n')
  const diff = git('diff -- .gitignore')
  fs.writeFileSync(path.join(projectDir, 'ignored-secret.pem'), TEST_PRIVATE_KEY_SECRET)
  fs.writeFileSync(path.join(projectDir, 'safe-change.txt'), 'safe content\n')
  git('add .gitignore safe-change.txt')
  git('commit --quiet --no-verify -m "test: add safe change"')
  await renderPreFrame(I, 'secret-ignored', diff.trimEnd())
})

storyboardStep(Then, 'the scan passes silently, the ignored secret stays out of sight', {
  note: 'scan-branch runs clean again and prints the same "No secrets detected in branch commits." line — the gitignored key was never part of what it scanned.',
  copy: 'task gitleaks:scan-branch'
}, async () => {
  const res = runScan()
  if (res.exitCode !== 0) {
    throw new Error(`Expected gitleaks scan-branch to succeed, exit=${res.exitCode}\n${res.output}`)
  }
  assertContains(res.output, 'No secrets detected in branch commits.')
  await renderPreFrame(I, 'verdict-silent', verdictText(res.output))
})
