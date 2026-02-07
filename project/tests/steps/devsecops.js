/**
 * DevSecOps Domain Steps
 *
 * Steps for testing project mode, phases, and coverage.
 */

const path = require('path')
const fs = require('fs')
const { resolvePath } = require('../step_objects/content')
const { executeCopier, executeCommand, initGitRepo, createInitialCommit } = require('../step_objects/commands')
const { deleteFileIfExists, ensureDir } = require('../step_objects/filesystem')
const { assertFileExists, assertFileContains, assertFileNotContains, assertDirExists } = require('../step_objects/assertions')
const { getTableCells } = require('../step_objects/tables')
const { resolveProjectPath } = require('../step_objects/config')
const { initTestContext } = require('../step_objects/copier')

function register () {
  // Given
  Given('a project was generated with project mode enabled', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { project_enabled: true })
  })

  Given('a project was generated with project mode disabled', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { project_enabled: false })
  })

  Given('a project has been generated with the DevSecOps toolbox', function () { // eslint-disable-line no-undef
    if (!this.projectRoot) {
      initTestContext(this, 'copier', 'scaffolding')
    }

    const projectRoot = this.projectRoot

    executeCopier(projectRoot)
    assertDirExists(projectRoot, `Project directory does not exist after generation: ${projectRoot}`)

    initGitRepo(projectRoot, { branch: 'origin/main' })
    createInitialCommit(projectRoot, { message: 'feat: init', tag: '0.1.0' })

    const taskfile = resolveProjectPath(this, '.config', 'devsecops', 'Taskfile.test.yml')
    assertFileExists(taskfile, `DevSecOps Taskfile.test.yml not found: ${taskfile}`)
  })

  Given('the project is initialized as a git repository', function () { // eslint-disable-line no-undef
    initGitRepo(this.projectRoot, { branch: 'main' })
    createInitialCommit(this.projectRoot, { message: 'feat: initial commit', tag: '0.1.0' })
    executeCommand('git update-ref refs/remotes/origin/main HEAD', { cwd: this.projectRoot })
  })

  // When
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
    const projectTaskfile = resolvePath(this, 'project/Taskfile.yml')
    deleteFileIfExists(projectTaskfile)
    executeCopier(this.projectRoot, { project_enabled: false }, { force: true })
  })

  When('the project is updated with project mode enabled', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { project_enabled: true }, { force: true })
  })

  When('I execute the DevSecOps task', function () { // eslint-disable-line no-undef
    executeCommand('task devsecops', { cwd: this.projectRoot })
  })

  // Then
  Then('the DevSecOps task should complete successfully', function () { // eslint-disable-line no-undef
    if (this.testError) {
      throw new Error(
        `DevSecOps task failed to execute in the generated project:\n${this.testError}\nOutput:\n${this.testResult}`
      )
    }
  })

  Then('the root Taskfile should include the project taskfile reference', function () { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, 'Taskfile.yml')
    assertFileContains(taskfilePath, 'project:\n    taskfile: project/Taskfile.yml')
  })

  Then('the root Taskfile should NOT include the project taskfile reference', function () { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, 'Taskfile.yml')
    assertFileNotContains(taskfilePath, 'project:\n    taskfile: project/Taskfile.yml')
  })

  Then('the following DevSecOps Taskfiles should call the project tasks:', function (table) { // eslint-disable-line no-undef
    const phases = getTableCells(table, 0)
    phases.forEach(phase => {
      const taskfilePath = resolvePath(this, `.config/devsecops/Taskfile.${phase}.yml`)
      assertFileContains(taskfilePath, ':project:' + phase)
    })
  })

  Then('the following DevSecOps Taskfiles should NOT call any project tasks:', function (table) { // eslint-disable-line no-undef
    const phases = getTableCells(table, 0)
    phases.forEach(phase => {
      const taskfilePath = resolvePath(this, `.config/devsecops/Taskfile.${phase}.yml`)
      assertFileNotContains(taskfilePath, ':project:')
    })
  })

  Then('the test taskfile should contain build coverage enabled', function () { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, '.config/devsecops/Taskfile.test.yml')
    assertFileContains(taskfilePath, 'TASK_DEVSECOPS_TEST_BUILD_COVERAGE_ENABLED: \'{{.TASK_DEVSECOPS_TEST_BUILD_COVERAGE_ENABLED | default "true"}}\'')
  })

  Then('the test taskfile should contain build coverage disabled', function () { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, '.config/devsecops/Taskfile.test.yml')
    assertFileContains(taskfilePath, 'TASK_DEVSECOPS_TEST_BUILD_COVERAGE_ENABLED: \'{{.TASK_DEVSECOPS_TEST_BUILD_COVERAGE_ENABLED | default "false"}}\'')
  })

  Then('the test taskfile should contain build coverage task prefix {string}', function (prefix) { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, '.config/devsecops/Taskfile.test.yml')
    assertFileContains(taskfilePath, `TASK_DEVSECOPS_TEST_BUILD_COVERAGE_TASK_PREFIX: '{{.TASK_DEVSECOPS_TEST_BUILD_COVERAGE_TASK_PREFIX | default "${prefix}"}}'`)
  })

  Then('the test taskfile should contain build coverage task prefix empty', function () { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, '.config/devsecops/Taskfile.test.yml')
    assertFileContains(taskfilePath, 'TASK_DEVSECOPS_TEST_BUILD_COVERAGE_TASK_PREFIX: \'{{.TASK_DEVSECOPS_TEST_BUILD_COVERAGE_TASK_PREFIX | default ""}}\'')
  })

  Then('the test taskfile should call project test task', function () { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, '.config/devsecops/Taskfile.test.yml')
    assertFileContains(taskfilePath, '- task: :project:test')
  })

  Then('the test taskfile should call project test tdd task', function () { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, '.config/devsecops/Taskfile.test.yml')
    assertFileContains(taskfilePath, '- task: :project:test:tdd')
  })

  Then('the test taskfile should NOT call project test task', function () { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, '.config/devsecops/Taskfile.test.yml')
    assertFileNotContains(taskfilePath, '- task: :project:test')
  })

  Then('the test taskfile should NOT call project test tdd task', function () { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, '.config/devsecops/Taskfile.test.yml')
    assertFileNotContains(taskfilePath, '- task: :project:test:tdd')
  })

  Then('the root Taskfile should include the project taskfile as flatten', function () { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, 'Taskfile.yml')
    assertFileContains(taskfilePath, 'project:\n    taskfile: project/Taskfile.yml\n    flatten: true')
  })

  Then('the project Taskfile should have the following prefixed tasks:', function (table) { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, 'project/Taskfile.yml')
    const tasks = getTableCells(table, 0)

    tasks.forEach(taskName => {
      const taskDefinition = `${taskName}:`
      assertFileContains(taskfilePath, taskDefinition)
    })
  })

  // Build coverage script steps
  Given('a minimal project with a non-flatten Taskfile include', function () { // eslint-disable-line no-undef
    initTestContext(this, 'devsecops', 'build-coverage-script')
    const root = this.projectRoot

    // Root Taskfile with a non-flatten include using "project:" namespace
    // This matches the default TASK_PREFIX so the script can find "project:build"
    fs.writeFileSync(path.join(root, 'Taskfile.yml'), [
      '---',
      "version: '3'",
      'includes:',
      '  project:',
      '    taskfile: services/Taskfile.yml',
      'tasks: {}',
      ''
    ].join('\n'))

    // Included Taskfile with a build task
    ensureDir(path.join(root, 'services'))
    fs.writeFileSync(path.join(root, 'services', 'Taskfile.yml'), [
      '---',
      "version: '3'",
      'tasks:',
      '  build:',
      '    cmds:',
      '      - echo "build"',
      ''
    ].join('\n'))

    // Docker compose file at the root of the scan directory
    ensureDir(path.join(root, 'project'))
    fs.writeFileSync(path.join(root, 'project', 'docker-compose.yml'), [
      '---',
      "version: '3'",
      'services:',
      '  app:',
      '    image: alpine',
      ''
    ].join('\n'))
  })

  When('the build coverage check is executed', function () { // eslint-disable-line no-undef
    const scriptPath = path.resolve(process.cwd(), '.config/devsecops/scripts/check-build-coverage.sh')
    const cmd = `PROJECT_ROOT=${this.projectRoot} bash ${scriptPath}`
    try {
      this.buildCoverageOutput = executeCommand(cmd, { silent: true })
      this.buildCoverageError = null
    } catch (err) {
      this.buildCoverageError = err
      this.buildCoverageOutput = err.message
    }
  })

  Then('the build coverage check should succeed', function () { // eslint-disable-line no-undef
    if (this.buildCoverageError) {
      throw new Error(
        `Build coverage check failed unexpectedly:\n${this.buildCoverageOutput}`
      )
    }
  })
}

// Auto-register when loaded by CodeceptJS
register()

module.exports = { register }
