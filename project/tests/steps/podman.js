/**
 * Podman Domain Steps
 *
 * Steps for testing Podman container runtime.
 */

const { resolvePath } = require('../step_objects/content')
const { assertFileContains, assertFileNotContains } = require('../step_objects/assertions')

function register () {
  // Then
  Then('the root Taskfile should include the podman taskfile reference', function () { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, 'Taskfile.yml')
    assertFileContains(taskfilePath, 'podman:\n    taskfile: .config/podman/Taskfile.yml')
  })

  Then('the root Taskfile should NOT include the podman taskfile reference', function () { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, 'Taskfile.yml')
    assertFileNotContains(taskfilePath, 'podman:')
  })
}

// Auto-register when loaded by CodeceptJS
register()

module.exports = { register }
