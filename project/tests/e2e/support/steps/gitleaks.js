/* global inject Given When Then Before After */
/**
 * Gitleaks scan-branch steps — functional secret-scanning proof on a
 * generated project (ported from the legacy template suite).
 *
 * The gitleaks Taskfile uses the docker run/cp/exec pattern (no bind mounts),
 * so the scan works from inside the codeceptjs runner through the mounted
 * docker socket. The container name is randomized per scenario because the
 * Taskfile default (gitleaks-container) would collide across parallel workers.
 */
const { I } = inject()
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { renderProject, removeRendered } = require('../helpers/copierRender')
const { stripAnsiEscapeSequences } = require('../helpers/docker')
const { assertTextVisualMatch } = require('../helpers/textRender')

const PRIVATE_KEY_HEADER_PARTS = ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----']
const PRIVATE_KEY_FOOTER_PARTS = ['-----END', 'RSA', 'PRIVATE', 'KEY-----']
const TEST_PRIVATE_KEY_SECRET = [
  PRIVATE_KEY_HEADER_PARTS.join(' '),
  'MIIEpAIBAAKCAQEA0testsecretfortemplategitleakstestingonly0000000000',
  PRIVATE_KEY_FOOTER_PARTS.join(' '),
  ''
].join('\n')

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

// ============================================
// GIVEN — generated project as a git branch
// ============================================

Given('a git-initialized project rendered from the working-branch template', () => {
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
})

Given('selective-copy fixtures exist on a feature branch', () => {
  fs.writeFileSync(path.join(projectDir, 'tracked.txt'), 'tracked file\n')
  git('add tracked.txt')
  git('commit --quiet --no-verify -m "test: add tracked fixture"')
  fs.writeFileSync(path.join(projectDir, 'untracked.txt'), 'untracked file\n')
  fs.appendFileSync(path.join(projectDir, '.gitignore'), '\nignored.secret\nignored-dir/\n')
  fs.writeFileSync(path.join(projectDir, 'ignored.secret'), 'ignored secret\n')
  fs.mkdirSync(path.join(projectDir, 'ignored-dir'), { recursive: true })
  fs.writeFileSync(path.join(projectDir, 'ignored-dir', 'inside.txt'), 'ignored nested file\n')
})

Given('a tracked file containing a fake private key is committed on a feature branch', () => {
  fs.writeFileSync(path.join(projectDir, 'tracked-secret.pem'), TEST_PRIVATE_KEY_SECRET)
  git('add tracked-secret.pem')
  git('commit --quiet --no-verify -m "test: add tracked secret fixture"')
})

Given('an ignored file containing a fake private key exists on a feature branch', () => {
  fs.appendFileSync(path.join(projectDir, '.gitignore'), '\nignored-secret.pem\n')
  fs.writeFileSync(path.join(projectDir, 'ignored-secret.pem'), TEST_PRIVATE_KEY_SECRET)
  fs.writeFileSync(path.join(projectDir, 'safe-change.txt'), 'safe content\n')
  git('add .gitignore safe-change.txt')
  git('commit --quiet --no-verify -m "test: add safe change"')
})

// ============================================
// WHEN — run the scan
// ============================================

When('I run gitleaks scan-branch in the project', () => {
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
})

// ============================================
// THEN — verdict
// ============================================

Then('the gitleaks run should succeed', () => {
  if (scanResult.exitCode !== 0) {
    throw new Error(`Expected gitleaks scan-branch to succeed, exit=${scanResult.exitCode}\n${scanResult.output}`)
  }
})

Then('the gitleaks run should fail', () => {
  if (scanResult.exitCode === 0) {
    throw new Error(`Expected gitleaks scan-branch to fail, but it succeeded\n${scanResult.output}`)
  }
})

Then('the gitleaks output should contain {string}', (expected) => {
  const cleaned = stripAnsiEscapeSequences(scanResult.output)
  if (!cleaned.includes(expected)) {
    throw new Error(`Expected gitleaks output to contain "${expected}"\n${cleaned}`)
  }
})

// The verdict block = the task's own contract lines, with the volatile scan
// range (commit SHA) masked. Findings/timings in between are volatile
// (commit dates, fingerprints) and are asserted by the string checks above.
Then('the gitleaks verdict should visually match {string}', async (baselineName) => {
  const VERDICT_RES = [
    /^🔍 Scanning commits from /,
    /^🎉 No secrets detected in branch commits\.$/,
    /^❌ Gitleaks detected secrets in your branch commits!$/,
    /^⚠️ {2}Please remove any secrets from the commits\.$/
  ]
  const lines = stripAnsiEscapeSequences(scanResult.output)
    .split('\n')
    .map(line => line.trim())
    .filter(line => VERDICT_RES.some(re => re.test(line)))
    .map(line => line.replace(/[0-9a-f]{7,40}/g, '<sha>'))
  if (lines.length === 0) {
    throw new Error(`No gitleaks verdict lines found in output:\n${scanResult.output}`)
  }
  await assertTextVisualMatch(I, baselineName, lines.join('\n'))
})
