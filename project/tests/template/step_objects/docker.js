/**
 * Docker Container Steps
 *
 * Step object for running install scripts in Docker containers
 * to validate cross-platform compatibility.
 */

const { execSync } = require('child_process')
const path = require('path')
const crypto = require('crypto')

// Track containers for cleanup
const activeContainers = []

/**
 * Generate a unique container name
 */
function containerName (image) {
  const slug = image.replace(/[^a-z0-9]/gi, '-')
  const id = crypto.randomBytes(4).toString('hex')
  return `test-install-${slug}-${id}`
}

/**
 * Start a Docker container from an image
 * Mounts .config/ so install scripts are accessible
 */
function startContainer (image) {
  const name = containerName(image)
  const configDir = path.resolve(process.cwd(), '.config')

  execSync(
    `docker run -d --name ${name} -v ${configDir}:/workspace/.config:ro ${image} sleep 300`,
    { encoding: 'utf8' }
  )
  activeContainers.push(name)
  return name
}

/**
 * Run a script inside a container
 * @returns {{ exitCode: number, output: string }}
 */
function runInContainer (name, script) {
  try {
    const output = execSync(
      `docker exec ${name} sh /workspace/${script}`,
      { encoding: 'utf8', timeout: 300000 }
    )
    return { exitCode: 0, output }
  } catch (err) {
    return { exitCode: err.status || 1, output: err.stdout || err.message }
  }
}

/**
 * Run a verification command inside a container
 * @returns {{ exitCode: number, output: string }}
 */
function verifyInContainer (name, cmd) {
  try {
    const output = execSync(
      `docker exec ${name} sh -c "${cmd}"`,
      { encoding: 'utf8', timeout: 30000 }
    )
    return { exitCode: 0, output }
  } catch (err) {
    return { exitCode: err.status || 1, output: err.stdout || err.message }
  }
}

/**
 * Stop and remove a container
 */
function removeContainer (name) {
  try {
    execSync(`docker rm -f ${name}`, { encoding: 'utf8' })
  } catch (_) {
    // Ignore errors on cleanup
  }
}

/**
 * Cleanup all active containers
 */
function cleanupAll () {
  activeContainers.forEach(removeContainer)
  activeContainers.length = 0
}

function register () {
  Given('a {string} container is running', function (image) { // eslint-disable-line no-undef
    this.containerName = startContainer(image)
  })

  When('I run {string} in the container', function (script) { // eslint-disable-line no-undef
    this.lastResult = runInContainer(this.containerName, script)
  })

  Then('the command should exit with code {int}', function (expectedCode) { // eslint-disable-line no-undef
    if (this.lastResult.exitCode !== expectedCode) {
      throw new Error(
        `Expected exit code ${expectedCode} but got ${this.lastResult.exitCode}\nOutput: ${this.lastResult.output}`
      )
    }
  })

  Then('{string} should succeed in the container', function (cmd) { // eslint-disable-line no-undef
    const result = verifyInContainer(this.containerName, cmd)
    if (result.exitCode !== 0) {
      throw new Error(
        `Verification command '${cmd}' failed with exit code ${result.exitCode}\nOutput: ${result.output}`
      )
    }
  })

  // Cleanup after each scenario
  After(function () { // eslint-disable-line no-undef
    if (this.containerName) {
      removeContainer(this.containerName)
      const idx = activeContainers.indexOf(this.containerName)
      if (idx !== -1) activeContainers.splice(idx, 1)
    }
  })
}

register()
module.exports = { register, cleanupAll }
