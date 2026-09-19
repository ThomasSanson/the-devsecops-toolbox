/* global inject Before After Given When Then */
/**
 * Betterleaks secret-scanning storyboard — the whole security promise as ONE
 * developer journey: an ordinary branch stays green, a committed secret gets
 * blocked and named, a secret kept out of git's view via .gitignore never
 * reaches the scanner. ONE Gherkin sentence = ONE storyboard card = ONE
 * pixel baseline, asserted inside the step (tolerance: 0); every verdict
 * card twins its <pre> frame with a programmatic assert of the same fact
 * (exit code / captured output).
 *
 * The betterleaks Taskfile uses the docker run/cp/exec pattern (no bind mounts),
 * so the scan works from inside the codeceptjs runner through the mounted
 * docker socket. The container name is randomized per scan because the
 * Taskfile default (betterleaks-container) would collide across parallel
 * workers. Three situations share the scenario, each on its OWN fresh
 * rendered project/branch (renderProject + git init): scan-branch scans the
 * WHOLE branch history since main, so a later commit must never bleed into
 * an earlier verdict.
 */
const { I } = inject()
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
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
  /^❌ Betterleaks detected secrets in your branch commits!$/,
  /^⚠️ {2}Please remove any secrets from the commits\.$/
]

let projectDir = null
let scanResult = null
let cleanupDirs = []
let betterleaksContainer = null
let binaryBinDir = null
let binaryEnv = null
let containersBefore = []

Before(() => {
  projectDir = null
  scanResult = null
  cleanupDirs = []
  betterleaksContainer = null
  binaryBinDir = null
  binaryEnv = null
  containersBefore = []
})

After(() => {
  cleanupDirs.forEach(removeRendered)
  cleanupDirs = []
  if (betterleaksContainer) {
    try {
      execSync(`docker rm -f ${betterleaksContainer}`, { stdio: 'pipe' })
    } catch (_) {
      // Already removed by the Taskfile defer.
    }
    betterleaksContainer = null
  }
  if (binaryBinDir) {
    try { fs.rmSync(binaryBinDir, { recursive: true, force: true }) } catch (_) {}
    binaryBinDir = null
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
  betterleaksContainer = `betterleaks-e2e-${crypto.randomBytes(4).toString('hex')}`
  const env = {
    ...process.env,
    TASK_BETTERLEAKS_CONTAINER_NAME: betterleaksContainer
  }
  try {
    const output = execSync('task betterleaks:scan-branch 2>&1', {
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
    throw new Error(`Expected betterleaks output to contain "${expected}"\n${cleaned}`)
  }
}

// task git:clean-secrets is interactive (reads "yes/no" on stdin) and, when
// git-filter-repo is absent (the runner image only ships plain git), falls back
// to git filter-branch. Feed the confirmation on stdin exactly as a developer
// types it; capture the combined output so the recovery card shows the real run.
function runCleanSecrets (file) {
  try {
    return execSync(`task git:clean-secrets -- ${file} 2>&1`, {
      cwd: projectDir,
      encoding: 'utf8',
      input: 'yes\n',
      stdio: 'pipe',
      timeout: 300000
    })
  } catch (error) {
    const out = stripAnsiEscapeSequences(`${error.stdout || ''}${error.stderr || ''}`)
    throw new Error(`task git:clean-secrets failed (exit ${error.status}):\n${out}`)
  }
}

// clean-secrets' only deterministic output is its own status lines: in between
// them git filter-branch streams volatile per-commit progress ("Rewrite <sha>
// (n/m) (t seconds…)", carriage-return overwritten) and a deprecation banner,
// and Task echoes the wrapper cmd. Keep just the status lines, in order — the
// same allowlist technique verdictText uses above. Real lines, never invented.
const CLEAN_VERDICT_RES = [
  /^File to remove: /,
  /^🔄 Cleaning Git history/,
  /git-filter-repo not found, using filter-branch/,
  /^Ref '.+' was rewritten$/,
  /^✅ History cleaned locally$/
]

function cleanSecretsFrame (rawOutput) {
  const lines = stripAnsiEscapeSequences(rawOutput)
    .split('\n')
    .map(line => line.trim())
    .filter(line => CLEAN_VERDICT_RES.some(re => re.test(line)))
  if (lines.length === 0) {
    throw new Error(`No clean-secrets status lines found in output:\n${rawOutput}`)
  }
  return lines.join('\n')
}

function verdictText (output) {
  const lines = stripAnsiEscapeSequences(output)
    .split('\n')
    .map(line => line.trim())
    .filter(line => VERDICT_RES.some(re => re.test(line)))
    .map(line => line.replace(/[0-9a-f]{7,40}/g, '<sha>'))
  if (lines.length === 0) {
    throw new Error(`No betterleaks verdict lines found in output:\n${output}`)
  }
  return lines.join('\n')
}

// ============================================
// Native mode (issue #225) — the scan on a machine with no Docker
// ============================================

// The binary mode of issue #225: the project sets TASK_BETTERLEAKS_MODE=binary
// (its Copier answer writes it into .env.dist) and the scan runs the pinned
// release binary instead of an image. `os.tmpdir()` gives the installer a
// fresh, writable folder per run, which also keeps its output identical on
// every run: an already-installed binary would print a different line.
function binaryModeEnv (binDir) {
  return {
    ...process.env,
    TASK_BETTERLEAKS_MODE: 'binary',
    TASK_BETTERLEAKS_BIN_DIR: binDir
  }
}

function runInBinaryMode (command, env) {
  try {
    return { exitCode: 0, output: execSync(`${command} 2>&1`, { cwd: projectDir, encoding: 'utf8', stdio: 'pipe', timeout: 300000, env }) }
  } catch (error) {
    return {
      exitCode: typeof error.status === 'number' ? error.status : 1,
      output: `${error.stdout || ''}${error.stderr || ''}`
    }
  }
}

// Containers whose name says they belong to a betterleaks scan, running or
// exited. The docker mode leaves one behind for a moment; the binary mode must
// never create one, and that is the fact the last card is twinned with.
function betterleaksContainersSeen () {
  return execSync('docker ps -a --format "{{.Names}}" --filter "name=betterleaks"', { encoding: 'utf8', stdio: 'pipe' })
    .split('\n').map(n => n.trim()).filter(Boolean)
}

const INSTALL_RES = [
  /^🔍 Installing betterleaks /,
  /^✅ Checksum verified/,
  /^🎉 betterleaks .* installed/
]

function installText (output) {
  const lines = stripAnsiEscapeSequences(output)
    .split('\n')
    .map(line => line.trim())
    .filter(line => INSTALL_RES.some(re => re.test(line)))
    .map(line => line.replace(/ in \/\S+/, ' in <bin-dir>'))
  if (lines.length === 0) {
    throw new Error(`No betterleaks install lines found in output:\n${output}`)
  }
  return lines.join('\n')
}

// ============================================
// Movement 1 — an ordinary branch stays green
// ============================================

storyboardStep(Given, "a project protected by the framework's secret scanner starts on a clean feature branch", async () => {
  newProject()
  const status = git('status')
  await renderPreFrame(I, 'stage-clean-branch', status.trimEnd())
})

storyboardStep(When, 'the developer commits ordinary tracked, untracked and ignored files', async () => {
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

storyboardStep(Then, 'the scan finds nothing to report', async () => {
  const res = runScan()
  if (res.exitCode !== 0) {
    throw new Error(`Expected betterleaks scan-branch to succeed, exit=${res.exitCode}\n${res.output}`)
  }
  assertContains(res.output, 'No secrets detected in branch commits.')
  await renderPreFrame(I, 'verdict-clean', verdictText(res.output))
})

// ============================================
// Movement 2 — a committed secret gets blocked
// ============================================

storyboardStep(When, 'the developer accidentally commits a private key to the branch', async () => {
  newProject()
  fs.writeFileSync(path.join(projectDir, 'tracked-secret.pem'), TEST_PRIVATE_KEY_SECRET)
  git('add tracked-secret.pem')
  git('commit --quiet --no-verify -m "test: add tracked secret fixture"')
  const content = fs.readFileSync(path.join(projectDir, 'tracked-secret.pem'), 'utf8')
  await renderPreFrame(I, 'secret-committed', content.trimEnd())
})

storyboardStep(Then, 'the scan blocks it and names the leak', async () => {
  const res = runScan()
  if (res.exitCode === 0) {
    throw new Error(`Expected betterleaks scan-branch to fail, but it succeeded\n${res.output}`)
  }
  assertContains(res.output, 'Betterleaks detected secrets in your branch commits!')
  await renderPreFrame(I, 'verdict-blocked', verdictText(res.output))
})

// ============================================
// Movement 2b — a secret in a .env file, which the allowlist used to ignore (#182)
// ============================================

storyboardStep(When, 'the developer commits a secret inside a secrets.yaml the scanner used to ignore', async () => {
  newProject()
  // A file literally named secrets.yaml, carrying a private key — the kind of
  // file the old allowlist told the scanner to skip. Force-add it in case a
  // downstream .gitignore lists it.
  fs.writeFileSync(path.join(projectDir, 'secrets.yaml'), TEST_PRIVATE_KEY_SECRET)
  git('add -f secrets.yaml')
  git('commit --quiet --no-verify -m "test: force-commit a secrets.yaml carrying a secret"')
  const content = fs.readFileSync(path.join(projectDir, 'secrets.yaml'), 'utf8')
  await renderPreFrame(I, 'secret-in-secrets-yaml', content.trimEnd())
})

storyboardStep(Then, 'the scan blocks it too, now the allowlist no longer skips secrets files', async () => {
  const res = runScan()
  if (res.exitCode === 0) {
    throw new Error(`Expected betterleaks to block a secret in secrets.yaml, but the scan passed\n${res.output}`)
  }
  assertContains(res.output, 'Betterleaks detected secrets in your branch commits!')
  await renderPreFrame(I, 'verdict-secrets-blocked', verdictText(res.output))
})

// ============================================
// Movement 3 — a gitignored secret never reaches the scanner
// ============================================

storyboardStep(When, 'the developer keeps a second secret out of the scan by gitignoring the file it lives in', async () => {
  newProject()
  fs.appendFileSync(path.join(projectDir, '.gitignore'), '\nignored-secret.pem\n')
  const diff = git('diff -- .gitignore')
  fs.writeFileSync(path.join(projectDir, 'ignored-secret.pem'), TEST_PRIVATE_KEY_SECRET)
  fs.writeFileSync(path.join(projectDir, 'safe-change.txt'), 'safe content\n')
  git('add .gitignore safe-change.txt')
  git('commit --quiet --no-verify -m "test: add safe change"')
  await renderPreFrame(I, 'secret-ignored', diff.trimEnd())
})

storyboardStep(Then, 'the scan passes silently, the ignored secret stays out of sight', async () => {
  const res = runScan()
  if (res.exitCode !== 0) {
    throw new Error(`Expected betterleaks scan-branch to succeed, exit=${res.exitCode}\n${res.output}`)
  }
  assertContains(res.output, 'No secrets detected in branch commits.')
  await renderPreFrame(I, 'verdict-silent', verdictText(res.output))
})

// ============================================
// Movement 4 — getting out of a secret block: the naive delete traps, clean-secrets frees
// ============================================

storyboardStep(Given, 'a committed private key is blocking a fresh branch', async () => {
  newProject()
  fs.writeFileSync(path.join(projectDir, 'tracked-secret.pem'), TEST_PRIVATE_KEY_SECRET)
  git('add tracked-secret.pem')
  git('commit --quiet --no-verify -m "test: add tracked secret fixture"')
  const res = runScan()
  if (res.exitCode === 0) {
    throw new Error(`Expected the committed secret to block the branch, but the scan passed\n${res.output}`)
  }
  assertContains(res.output, 'Betterleaks detected secrets in your branch commits!')
  await renderPreFrame(I, 'block-recall', verdictText(res.output))
})

storyboardStep(When, 'the developer deletes the secret file and commits the removal', async () => {
  git('rm --quiet tracked-secret.pem')
  git('commit --quiet --no-verify -m "chore: remove the secret file"')
  // The removal hides the file from the latest tree, but the commit that ADDED
  // it still sits in the branch history — prove that before the scan confirms it.
  const stillInHistory = git('log --oneline -- tracked-secret.pem').trim()
  if (stillInHistory === '') {
    throw new Error('Fixture: the secret should still be reachable in history after a naive delete')
  }
  const log = git('log --oneline').trimEnd().replace(/^[0-9a-f]{7,40}/gm, '<sha>')
  await renderPreFrame(I, 'naive-removal', log)
})

storyboardStep(Then, 'the scan still refuses the branch because the secret stays in its history', async () => {
  const res = runScan()
  if (res.exitCode === 0) {
    throw new Error(`Expected the scan to still fail after a naive delete, but it passed\n${res.output}`)
  }
  assertContains(res.output, 'Betterleaks detected secrets in your branch commits!')
  await renderPreFrame(I, 'trap-still-blocked', verdictText(res.output))
})

storyboardStep(When, "the developer rewrites the history with the framework's clean-secrets task", async () => {
  const raw = runCleanSecrets('tracked-secret.pem')
  // Twin: the file is gone from the entire branch history, not just the tip.
  const purged = git('log --oneline --all -- tracked-secret.pem').trim()
  if (purged !== '') {
    throw new Error(`Expected clean-secrets to purge the file from history, still found:\n${purged}`)
  }
  await renderPreFrame(I, 'history-cleaned', cleanSecretsFrame(raw))
})

storyboardStep(Then, 'the scan comes back clean and the branch is safe to push', async () => {
  const res = runScan()
  if (res.exitCode !== 0) {
    throw new Error(`Expected the scan to pass after clean-secrets, exit=${res.exitCode}\n${res.output}`)
  }
  assertContains(res.output, 'No secrets detected in branch commits.')
  await renderPreFrame(I, 'branch-clean', verdictText(res.output))
})

// ============================================
// Movement 5 — the same scan from the pinned binary (issue #225)
// ============================================

storyboardStep(When, 'a project set to the binary mode installs the pinned scanner', async () => {
  newProject()
  fs.writeFileSync(path.join(projectDir, 'tracked-secret.pem'), TEST_PRIVATE_KEY_SECRET)
  git('add tracked-secret.pem')
  git('commit --quiet --no-verify -m "test: add tracked secret fixture"')

  binaryBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'betterleaks-binary-'))
  binaryEnv = binaryModeEnv(binaryBinDir)
  containersBefore = betterleaksContainersSeen()

  const res = runInBinaryMode('task betterleaks:install', binaryEnv)
  if (res.exitCode !== 0) {
    throw new Error(`Expected the pinned install to succeed, exit=${res.exitCode}\n${res.output}`)
  }
  // Twin: a real binary landed in the folder and answers for the pinned version.
  const installed = path.join(binaryBinDir, 'betterleaks')
  if (!fs.existsSync(installed)) {
    throw new Error(`Expected the installer to place a binary in ${binaryBinDir}\n${res.output}`)
  }
  const pinned = fs.readFileSync(path.join(projectDir, '.config/betterleaks/version'), 'utf8').trim()
  const reported = execSync(`${installed} version 2>&1`, { encoding: 'utf8' }).trim()
  if (!reported.includes(pinned)) {
    throw new Error(`Expected the installed binary to report the pinned version ${pinned}, got: ${reported}`)
  }
  await renderPreFrame(I, 'binary-install', installText(res.output))
})

storyboardStep(Then, 'the same committed key is blocked again, and no container was ever started', async () => {
  const res = runInBinaryMode('task betterleaks:scan-branch', binaryEnv)
  if (res.exitCode === 0) {
    throw new Error(`Expected the binary-mode scan to fail on the committed key\n${res.output}`)
  }
  assertContains(res.output, 'Betterleaks detected secrets in your branch commits!')
  // Twin, and the one that says this really was the binary mode: the scan
  // created no container, so nothing could have quietly fallen back to an image.
  const created = betterleaksContainersSeen().filter(name => !containersBefore.includes(name))
  if (created.length > 0) {
    throw new Error(`Expected the binary mode to start no container, found: ${created.join(', ')}`)
  }
  await renderPreFrame(I, 'binary-verdict-blocked', verdictText(res.output))
})
