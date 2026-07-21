/* global inject Before After Given When Then */
/**
 * Installer hard-exit storyboard — @installer-no-curl.
 *
 * The counterpart to @fresh-machine (which proves the installer patches a
 * missing prerequisite and carries on): this one proves the installer REFUSES
 * cleanly when the one tool it cannot install itself — curl — is absent. On a
 * barren Ubuntu with no curl the installer stops at its very first check, names
 * the missing tool and exits non-zero, before any download.
 *
 * ONE Gherkin sentence = ONE card = ONE pixel baseline, asserted inside the step
 * (tolerance: 0); the verdict card twins its <pre> frame with an exit-code +
 * message assert. Pure container + installer, no GitLab, no network.
 */
const { I } = inject()
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

let bareContainer = null
let installerResult = null

// Gherkin Before/After hooks are GLOBAL across every scenario the worker
// runs — guard by the owning tag so this cleanup never fires mid-scenario
// for a parallel story (see daily-contribution.js for the war story).
const ownsScenario = (test) => Boolean(test && test.tags && test.tags.includes('@fresh-machine'))

Before((test) => {
  if (!ownsScenario(test)) return
  bareContainer = null
  installerResult = null
})

After((test) => {
  if (!ownsScenario(test)) return
  if (bareContainer) {
    removeContainer(bareContainer)
    bareContainer = null
  }
})

function assertOutputContains (expected) {
  const cleaned = stripAnsiEscapeSequences(installerResult.output)
  if (!cleaned.includes(expected)) {
    throw new Error(`Expected installer output to contain "${expected}"\n--- output ---\n${cleaned}`)
  }
}

function block (output, marker, before, after) {
  const lines = stripAnsiEscapeSequences(output).replace(/\r/g, '').split('\n')
  const idx = lines.findIndex(line => line.includes(marker))
  const slice = idx < 0 ? lines : lines.slice(Math.max(0, idx - before), idx + after)
  return slice.join('\n').trimEnd()
}

storyboardStep(Given, 'a fresh machine without curl, with the installer ready to run', async () => {
  bareContainer = containerName()
  // ubuntu:24.04 ships without curl — exactly the barren state under test.
  execSync(`docker run -d --name ${shellEscape(bareContainer)} ubuntu:24.04 sleep infinity`, {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: SETUP_TIMEOUT
  })
  execSync(
    `docker cp /workspace/.config/devsecops/install.sh ${shellEscape(`${bareContainer}:/tmp/install.sh`)}`,
    { stdio: 'pipe', timeout: SETUP_TIMEOUT }
  )
  const check = execInContainer(bareContainer, 'command -v curl || echo "curl: command not found"')
  await renderPreFrame(I, 'no-curl', stripAnsiEscapeSequences(check.output || '').trimEnd())
})

storyboardStep(When, 'the installer runs on that machine', async () => {
  installerResult = execInContainer(bareContainer, 'bash /tmp/install.sh')
  // 'installer-launch-no-curl', not 'installer-launch': chapter 2 of the
  // merged @fresh-machine story captures its own launch under that name, and
  // two frames sharing a name overwrite each other's baseline.
  await renderPreFrame(I, 'installer-launch-no-curl', block(installerResult.output, 'DevSecOps Toolbox Installer', 0, 3))
})

storyboardStep(Then, 'the installer stops and says curl must be installed first', async () => {
  if (installerResult.exitCode === 0) {
    throw new Error(`Expected the installer to fail without curl, but it exited 0\n${installerResult.output}`)
  }
  assertOutputContains('curl is required but not installed.')
  assertOutputContains('Install curl with your package manager')
  await renderPreFrame(I, 'refusal', block(installerResult.output, 'curl is required but not installed.', 0, 2))
})
