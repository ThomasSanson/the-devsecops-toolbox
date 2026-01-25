/**
 * Glab Domain Steps
 *
 * Steps for testing glab (GitLab CLI) tool integration.
 */

const { resolvePath } = require('../step_objects/content')
const { assertFileContains } = require('../step_objects/assertions')

function register () {
  // Then
  Then('the root Taskfile should include the glab taskfile reference', function () { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, 'Taskfile.yml')
    assertFileContains(taskfilePath, 'glab:\n    taskfile: .config/glab/Taskfile.yml')
  })
}

// Auto-register when loaded by CodeceptJS
register()

module.exports = { register }
