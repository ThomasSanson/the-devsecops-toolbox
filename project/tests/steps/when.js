/**
 * Shared When Steps
 *
 * Generic When step definitions reusable by all domains.
 * Uses test context (this) to get the project root for isolated testing.
 */

const { executeCopier, executeCommand } = require('./support/commands')
const { removeDirRecursive, deleteFileIfExists } = require('./support/filesystem')
const { resolveProjectPath } = require('./support/config')

function register () {
  // Copier generation steps
  When('the copier command is executed to generate a project from the template', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot)
  })

  // Ansible specific
  When('the copier command is executed with Ansible enabled', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { ansible_enabled: true })
  })

  When('the copier command is executed with default settings for Ansible', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot)
  })

  When('the project is updated with Ansible disabled', function () { // eslint-disable-line no-undef
    // Remove Ansible directories before regeneration (Copier doesn't auto-delete excluded files)
    const ansibleDir = resolveProjectPath(this, '.config/ansible')
    const ansibleLintDir = resolveProjectPath(this, '.config/ansible-lint')
    removeDirRecursive(ansibleDir)
    removeDirRecursive(ansibleLintDir)
    executeCopier(this.projectRoot, { ansible_enabled: false }, { force: true })
  })

  When('the project is updated with Ansible enabled', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { ansible_enabled: true }, { force: true })
  })

  // Project mode specific
  When('the copier command is executed with project mode enabled', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { project_enabled: true })
  })

  When('the copier command is executed with default settings for project mode', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot)
  })

  When('the copier command is executed with project mode disabled', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { project_enabled: false })
  })

  When('the project is updated with project mode disabled', function () { // eslint-disable-line no-undef
    // Remove project Taskfile before regeneration (Copier doesn't auto-delete excluded files)
    const projectTaskfile = resolveProjectPath(this, 'project/Taskfile.yml')
    deleteFileIfExists(projectTaskfile)
    executeCopier(this.projectRoot, { project_enabled: false }, { force: true })
  })

  When('the project is updated with project mode enabled', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { project_enabled: true }, { force: true })
  })

  // CI Platform specific
  When('the copier command is executed with CI platform {string}', function (ciPlatform) { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { ci_platform: ciPlatform })
  })

  When('the project is updated with CI platform {string}', function (ciPlatform) { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { ci_platform: ciPlatform }, { force: true })
  })

  // DevSecOps task execution
  When('I execute the DevSecOps task', function () { // eslint-disable-line no-undef
    executeCommand('task devsecops', { cwd: this.projectRoot })
  })
}

module.exports = { register }
