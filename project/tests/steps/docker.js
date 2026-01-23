/**
 * Docker Domain Steps
 *
 * Steps for testing Docker container runtime.
 */

const { resolvePath } = require('../step_objects/content')
const { executeCopier } = require('../step_objects/commands')
const { removeDirRecursive } = require('../step_objects/filesystem')
const { assertFileContains, assertFileNotContains } = require('../step_objects/assertions')

function register () {
  // Given
  Given('a project was generated with container runtime {string}', function (runtime) { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { container_runtime: runtime })
  })

  // When
  When('the copier command is executed with container runtime {string}', function (runtime) { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { container_runtime: runtime })
  })

  When('the project is updated with container runtime {string}', function (runtime) { // eslint-disable-line no-undef
    const dockerDir = resolvePath(this, '.config/docker-ce')
    const podmanDir = resolvePath(this, '.config/podman')
    removeDirRecursive(dockerDir)
    removeDirRecursive(podmanDir)
    executeCopier(this.projectRoot, { container_runtime: runtime }, { force: true })
  })

  // Then
  Then('the root Taskfile should include the docker-ce taskfile reference', function () { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, 'Taskfile.yml')
    assertFileContains(taskfilePath, 'docker-ce:\n    taskfile: .config/docker-ce/Taskfile.yml')
  })

  Then('the root Taskfile should NOT include the docker-ce taskfile reference', function () { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, 'Taskfile.yml')
    assertFileNotContains(taskfilePath, 'docker-ce:')
  })
}

// Auto-register when loaded by CodeceptJS
register()

module.exports = { register }
