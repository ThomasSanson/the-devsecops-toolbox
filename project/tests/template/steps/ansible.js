/**
 * Ansible Domain Steps
 *
 * Steps for testing .config/ansible integration.
 */

const { resolvePath } = require('../step_objects/content')
const { executeCopier } = require('../step_objects/commands')
const { assertFileContains, assertFileNotContains } = require('../step_objects/assertions')

function register () {
  // Given
  Given('a project was generated with Ansible enabled', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { ansible_enabled: true })
  })

  Given('a project was generated with Ansible disabled', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { ansible_enabled: false })
  })

  // When
  When('the copier command is executed with Ansible enabled', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { ansible_enabled: true })
  })

  When('the copier command is executed with default settings for Ansible', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot)
  })

  When('the project is updated with Ansible disabled', function () { // eslint-disable-line no-undef
    const { removeDirRecursive } = require('../step_objects/filesystem')
    const ansibleDir = resolvePath(this, '.config/ansible')
    const ansibleLintDir = resolvePath(this, '.config/ansible-lint')
    removeDirRecursive(ansibleDir)
    removeDirRecursive(ansibleLintDir)
    executeCopier(this.projectRoot, { ansible_enabled: false }, { force: true })
  })

  When('the project is updated with Ansible enabled', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { ansible_enabled: true }, { force: true })
  })

  // Then
  Then('the Taskfile should include the Ansible taskfile reference', function () { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, 'Taskfile.yml')
    assertFileContains(taskfilePath, 'ansible:\n    taskfile: .config/ansible/Taskfile.yml')
  })

  Then('the Taskfile should NOT include the Ansible taskfile reference', function () { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, 'Taskfile.yml')
    assertFileNotContains(taskfilePath, 'ansible:')
  })
}

// Auto-register when loaded by CodeceptJS
register()

module.exports = { register }
