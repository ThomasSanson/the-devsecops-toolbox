/**
 * Docker Domain Steps
 *
 * Steps for testing Docker container runtime.
 */

const { initTestContext } = require('../support/copierSteps')
const { resolvePath } = require('../support/contentSteps')
const { executeCopier } = require('../support/commands')
const { removeDirRecursive } = require('../support/filesystem')
const { assertFileContains, assertFileNotContains } = require('../support/assertions')

function register () {
  // Given
  Given('a clean temporary directory for docker runtime tests', function () { // eslint-disable-line no-undef
    initTestContext(this, 'docker', 'runtime')
  })

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

module.exports = { register }
