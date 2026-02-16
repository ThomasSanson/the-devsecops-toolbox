/**
 * Taskfile System Steps
 *
 * Steps for verifying Taskfile content structure.
 */

const { resolvePath } = require('../step_objects/content') // Using content.js for path resolution
const { getKeyValuePairs } = require('../step_objects/tables')
const { execSync } = require('child_process')
const fs = require('fs')

function register () {
  /**
   * Verify a task contains a specific command using simple text parsing
   *
   * Example:
   *   Then the task "setup-environment" in file ".config/dev/Taskfile.yml" should contain "- task: lefthook"
   */
  Then('the task {string} in file {string} should contain {string}', function (taskName, relativePath, expectedCommand) { // eslint-disable-line no-undef
    const filePath = resolvePath(this, relativePath)
    const fileContent = fs.readFileSync(filePath, 'utf8')
    const lines = fileContent.split('\n')

    let inTargetTask = false
    let found = false
    let taskIndentation = -1

    // Simple normalization of expectation
    const normalizedExpected = expectedCommand.trim()

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmedLine = line.trim()

      // Skip empty lines or comments
      if (!trimmedLine || trimmedLine.startsWith('#')) continue

      // Check for task definition start: "  taskName:" or "taskName:"
      // We assume tasks are at the top level under 'tasks:' or indented
      const taskMatch = line.match(new RegExp(`^(\\s*)${taskName}:`))

      if (taskMatch) {
        inTargetTask = true
        taskIndentation = taskMatch[1].length
        continue
      }

      if (inTargetTask) {
        // Check current indentation
        const currentIndentation = line.match(/^(\s*)/)[1].length

        // If indentation matches or is less than the task definition, we've exited the task block
        // (unless it's empty line handled above)
        if (currentIndentation <= taskIndentation) {
          break
        }

        // Check content match
        if (trimmedLine.includes(normalizedExpected)) {
          found = true
          break
        }
      }
    }

    if (!found) {
      throw new Error(`Task "${taskName}" in ${relativePath} does not contain command: "${expectedCommand}".`)
    }
  })

  Then('the task {string} in file {string} should NOT contain {string}', function (taskName, relativePath, unexpectedCommand) { // eslint-disable-line no-undef
    const filePath = resolvePath(this, relativePath)
    const fileContent = fs.readFileSync(filePath, 'utf8')
    const lines = fileContent.split('\n')

    let inTargetTask = false
    let found = false
    let taskIndentation = -1
    const normalizedUnexpected = unexpectedCommand.trim()

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmedLine = line.trim()

      if (!trimmedLine || trimmedLine.startsWith('#')) continue

      const taskMatch = line.match(new RegExp(`^(\\s*)${taskName}:`))
      if (taskMatch) {
        inTargetTask = true
        taskIndentation = taskMatch[1].length
        continue
      }

      if (inTargetTask) {
        const currentIndentation = line.match(/^(\s*)/)[1].length
        if (currentIndentation <= taskIndentation) {
          break
        }

        if (trimmedLine.includes(normalizedUnexpected)) {
          found = true
          break
        }
      }
    }

    if (found) {
      throw new Error(`Task "${taskName}" in ${relativePath} unexpectedly contains command: "${unexpectedCommand}".`)
    }
  })

  /**
   * Run a task in the generated project directory with specific env vars
   *
   * Example:
   *   When I run task "megalinter:proxy:debug" in the generated project with env vars:
   *     | HTTP_PROXY | http://proxy.test:8080 |
   */
  When('I run task {string} in the generated project with env vars:', function (taskName, dataTable) { // eslint-disable-line no-undef
    const envVars = getKeyValuePairs(dataTable)
    const envPrefix = Object.entries(envVars)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')

    this.taskOutput = execSync(`${envPrefix} task ${taskName}`, {
      encoding: 'utf8',
      cwd: this.projectRoot
    }).trim()
  })

  When('I run task {string} in the generated project', function (taskName) { // eslint-disable-line no-undef
    this.taskOutput = execSync(`task ${taskName}`, {
      encoding: 'utf8',
      cwd: this.projectRoot
    }).trim()
  })

  When('I run task {string} in the generated project and capture the result', function (taskName) { // eslint-disable-line no-undef
    try {
      const output = execSync(`task ${taskName}`, {
        encoding: 'utf8',
        cwd: this.projectRoot
      })
      this.taskExitCode = 0
      this.taskOutput = (output || '').trim()
    } catch (err) {
      const stdout = err.stdout ? String(err.stdout) : ''
      const stderr = err.stderr ? String(err.stderr) : ''
      this.taskExitCode = typeof err.status === 'number' ? err.status : 1
      this.taskOutput = `${stdout}${stderr}`.trim()
    }
  })

  Then('the task should fail', function () { // eslint-disable-line no-undef
    if (this.taskExitCode === 0) {
      throw new Error(`Expected task to fail, but it succeeded. Output: "${this.taskOutput || ''}"`)
    }
  })

  Then('the task should succeed', function () { // eslint-disable-line no-undef
    if (this.taskExitCode !== 0) {
      throw new Error(`Expected task to succeed, but it failed with exit code ${this.taskExitCode}. Output: "${this.taskOutput || ''}"`)
    }
  })

  Then('the task output should contain {string}', function (expected) { // eslint-disable-line no-undef
    if (!this.taskOutput || !this.taskOutput.includes(expected)) {
      throw new Error(`Expected task output to contain "${expected}", but got: "${this.taskOutput || ''}"`)
    }
  })

  Then('the task output should not contain {string}', function (unexpected) { // eslint-disable-line no-undef
    if (this.taskOutput && this.taskOutput.includes(unexpected)) {
      throw new Error(`Expected task output NOT to contain "${unexpected}", but it was found in: "${this.taskOutput}"`)
    }
  })
}

// Auto-register when loaded by CodeceptJS
register()

module.exports = { register }
