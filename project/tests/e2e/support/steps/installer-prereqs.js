/* global inject Before After Given When Then */
/**
 * Bare-machine cold-start storyboard — the installer proving its OWN
 * prerequisites on a machine that has none: a barren Ubuntu with only sudo
 * and curl, the installer launching, patching its own gap (unzip) with
 * sudo, then stopping with the ONE piece of guidance that actually unblocks
 * a developer (link a GitLab remote). ONE Gherkin sentence = ONE storyboard
 * card = ONE pixel baseline, asserted inside the step (tolerance: 0); each
 * verdict card twins its <pre> frame with a programmatic log assert of the
 * same fact.
 */
const { I } = inject()
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const {
  shellEscape,
  containerName,
  execInContainer,
  removeContainer,
  stripAnsiEscapeSequences
} = require('../helpers/docker')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const { renderPreFrame } = require('../helpers/capturedOutput')

const SETUP_TIMEOUT = 300000
const INSTALLER_TIMEOUT = 600000

let bareContainer = null
let installerResult = null

Before(() => {
  bareContainer = null
  installerResult = null
})

After(() => {
  if (bareContainer) {
    removeContainer(bareContainer)
    bareContainer = null
  }
})

function assertOutputContains (expected) {
  const cleaned = stripAnsiEscapeSequences(installerResult.output)
  if (!cleaned.includes(expected)) {
    throw new Error(`Expected installer output to contain "${expected}"\n--- output tail ---\n${cleaned.slice(-3000)}`)
  }
}

// ============================================
// Given — the barren machine, installer staged
// ============================================

storyboardStep(Given, 'a fresh machine has only sudo and curl, with the installer ready to run', async () => {
  bareContainer = containerName()
  execSync(`docker run -d --name ${shellEscape(bareContainer)} ubuntu:24.04 sleep infinity`, {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: SETUP_TIMEOUT
  })
  const setup = execInContainer(bareContainer, [
    'apt-get update -qq',
    'apt-get install -y -qq sudo curl >/dev/null',
    'id bootstrap >/dev/null 2>&1 || useradd -m -s /bin/bash bootstrap',
    "printf '%s\\n' 'bootstrap ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/bootstrap",
    'chmod 0440 /etc/sudoers.d/bootstrap',
    'mkdir -p /workspace && chown -R bootstrap:bootstrap /workspace'
  ].join(' && '), { user: 'root' })
  if (setup.exitCode !== 0) {
    throw new Error(`Failed to prepare the bare container:\n${setup.output}`)
  }

  execSync(
    `docker cp /workspace/.config/devsecops/install.sh ${shellEscape(`${bareContainer}:/tmp/install.sh`)}`,
    { stdio: 'pipe', timeout: SETUP_TIMEOUT }
  )
  const mk = execInContainer(bareContainer, 'mkdir -p /tmp/toolbox-template', { user: 'root' })
  if (mk.exitCode !== 0) {
    throw new Error(`Failed to create the template dir:\n${mk.output}`)
  }
  execSync(
    `docker cp /workspace/. ${shellEscape(`${bareContainer}:/tmp/toolbox-template`)}`,
    { stdio: 'pipe', timeout: SETUP_TIMEOUT }
  )
  const own = execInContainer(
    bareContainer,
    'chown -R bootstrap:bootstrap /tmp/install.sh /tmp/toolbox-template',
    { user: 'root' }
  )
  if (own.exitCode !== 0) {
    throw new Error(`Failed to fix installer ownership:\n${own.output}`)
  }

  const check = execInContainer(bareContainer, 'command -v unzip || echo "unzip: command not found"')
  await renderPreFrame(I, 'barren-tooling', stripAnsiEscapeSequences(check.output || '').trimEnd())
})

// ============================================
// When — the installer runs, non-interactively
// ============================================

storyboardStep(When, 'the installer runs on the fresh machine with no one to answer its questions', async () => {
  const cmd = [
    `docker exec -u bootstrap -e DEVSECOPS_TEMPLATE_URL=/tmp/toolbox-template ${shellEscape(bareContainer)}`,
    `sh -c ${shellEscape("mkdir -p /workspace/my-project && cd /workspace/my-project && yes '' | head -n 40 | bash /tmp/install.sh")}`
  ].join(' ')
  try {
    const output = execSync(`${cmd} 2>&1`, { encoding: 'utf8', stdio: 'pipe', timeout: INSTALLER_TIMEOUT })
    installerResult = { exitCode: 0, output }
  } catch (error) {
    installerResult = {
      exitCode: typeof error.status === 'number' ? error.status : 1,
      output: `${error.stdout || ''}${error.stderr || ''}`
    }
  }
  // Full session log as a debug artifact (CodeceptJS truncates error messages).
  const artifact = path.join(__dirname, '..', '..', '_output', 'installer', 'prerequisites-failure.log')
  fs.mkdirSync(path.dirname(artifact), { recursive: true })
  fs.writeFileSync(artifact, installerResult.output)

  const cleaned = stripAnsiEscapeSequences(installerResult.output).replace(/\r/g, '')
  const lines = cleaned.split('\n')
  // Two signature lines only: what sits BETWEEN them (blank lines, download
  // chatter) varies with container warm-up speed and broke tolerance:0 when
  // a preceding chapter warmed the caches.
  const banner = [
    lines.find(line => line.includes('DevSecOps Toolbox Installer')),
    lines.find(line => line.includes('Installing toolchain'))
  ].filter(Boolean).join('\n').trimEnd()
  await renderPreFrame(I, 'installer-launch', banner)
})

// ============================================
// Then — the auto-install, then the final guidance
// ============================================

storyboardStep(Then, 'the installer installs the tool it was missing and tries again', async () => {
  assertOutputContains('DevSecOps Toolbox Installer')
  assertOutputContains('task devsecops:init failed. Attempting to install missing prerequisites...')
  assertOutputContains('Installing unzip with sudo...')

  const cleaned = stripAnsiEscapeSequences(installerResult.output).replace(/\r/g, '')
  const lines = cleaned.split('\n')
  const idx = lines.findIndex(line => line.includes('Attempting to install missing prerequisites'))
  const slice = (idx < 0 ? lines : lines.slice(Math.max(0, idx - 1), idx + 3)).join('\n').trimEnd()
  await renderPreFrame(I, 'prerequisite-installed', slice)
})

// The final guidance block (from the no-remote diagnosis down) is the
// deterministic contract; everything above it (apt, toolchain downloads,
// temp dirs) is volatile and covered by the string assertions in the
// previous card. LAST occurrence: the marker first fires before the
// prerequisites install, and the retry that follows floods the output with
// unpinned toolchain versions (uv, docker, node, …) that drift over time.
// Only the final failure block after the retry is deterministic.
const NO_REMOTE_MARKER = "No 'origin' remote configured. Add a GitLab remote, then re-run."

storyboardStep(Then, 'the installer stops and explains how to link the project to GitLab', async () => {
  if (installerResult.exitCode === 0) {
    throw new Error(`Expected the installer to fail without a GitLab remote, but it succeeded\n${installerResult.output}`)
  }
  assertOutputContains(NO_REMOTE_MARKER)

  const cleaned = stripAnsiEscapeSequences(installerResult.output).replace(/\r/g, '')
  const lines = cleaned.split('\n')
  const start = lines.findLastIndex(line => line.includes(NO_REMOTE_MARKER))
  if (start < 0) {
    throw new Error(`Marker "${NO_REMOTE_MARKER}" not found in installer output:\n${cleaned.slice(-3000)}`)
  }
  const block = lines.slice(start).join('\n').trimEnd()
  await renderPreFrame(I, 'final-guidance', block)
})
