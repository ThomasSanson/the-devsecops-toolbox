/* global inject Given When Then Before After */
/**
 * Installer prerequisite-path steps (ported from the legacy bootstrap suite).
 *
 * The journey's ubuntu image pre-installs git/jq/unzip, so the installer's
 * prerequisite branches can never trigger there. These steps spawn a BARE
 * ubuntu:24.04 container (sudo + curl only) and prove the installer
 * auto-installs the missing prerequisites with sudo, then fails cleanly with
 * actionable guidance when the project has no GitLab remote.
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
const { assertTextVisualMatch } = require('../helpers/textRender')

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

// ============================================
// GIVEN — bare container
// ============================================

Given('a bare Ubuntu container with only sudo and curl', () => {
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
})

Given('the working-branch installer is staged in the bare container', () => {
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
})

// ============================================
// WHEN — run the installer (no tty, defaults)
// ============================================

When('I run the installer non-interactively in the bare container', () => {
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
})

// ============================================
// THEN — auto-install proof + clean failure
// ============================================

Then('the bare-container installer run should fail', () => {
  if (installerResult.exitCode === 0) {
    throw new Error(`Expected the installer to fail without a GitLab remote, but it succeeded\n${installerResult.output}`)
  }
})

Then('the bare-container installer output should contain {string}', (expected) => {
  const cleaned = stripAnsiEscapeSequences(installerResult.output)
  if (!cleaned.includes(expected)) {
    throw new Error(`Expected installer output to contain "${expected}"\n--- output tail ---\n${cleaned.slice(-3000)}`)
  }
})

// The final guidance block (from the no-remote diagnosis down) is the
// deterministic contract; everything above it (apt, toolchain downloads,
// temp dirs) is volatile and covered by the string assertions.
const NO_REMOTE_MARKER = "No 'origin' remote configured. Add a GitLab remote, then re-run."

Then('the bare-container installer guidance should visually match {string}', async (baselineName) => {
  const cleaned = stripAnsiEscapeSequences(installerResult.output).replace(/\r/g, '')
  const lines = cleaned.split('\n')
  // LAST occurrence: the marker first fires before the prerequisites install,
  // and the retry that follows floods the output with unpinned toolchain
  // versions (uv, docker, node, …) that drift over time. Only the final
  // failure block after the retry is deterministic.
  const start = lines.findLastIndex(line => line.includes(NO_REMOTE_MARKER))
  if (start < 0) {
    throw new Error(`Marker "${NO_REMOTE_MARKER}" not found in installer output:\n${cleaned.slice(-3000)}`)
  }
  const block = lines.slice(start).join('\n').trimEnd()
  await assertTextVisualMatch(I, baselineName, block)
})
