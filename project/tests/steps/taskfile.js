/**
 * Taskfile System Steps
 *
 * Steps for verifying Taskfile content structure.
 */

const { resolvePath } = require('../step_objects/content') // Using content.js for path resolution
const fs = require('fs')

function register () {

  /**
   * Verify a task contains a specific command using simple text parsing
   *
   * Example:
   *   Then the task "setup-environment" in file ".config/dev/Taskfile.yml" should contain "- task: lefthook"
   */
  Then('the task {string} in file {string} should contain {string}', function (taskName, relativePath, expectedCommand) {
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
}

// Auto-register when loaded by CodeceptJS
register()

module.exports = { register }
