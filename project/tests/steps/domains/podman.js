/**
 * Podman Domain Steps
 *
 * Steps for testing Podman container runtime.
 */

const { initTestContext } = require('../support/copierSteps')
const { resolvePath } = require('../support/contentSteps')
const { assertFileContains, assertFileNotContains } = require('../support/assertions')

function register () {
  // Given
  Given('a clean temporary directory for podman runtime tests', function () { // eslint-disable-line no-undef
    initTestContext(this, 'podman', 'runtime')
  })

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

module.exports = { register }
