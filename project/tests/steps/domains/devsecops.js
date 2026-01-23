/**
 * DevSecOps Domain Steps
 *
 * Steps for testing project mode, phases, and coverage.
 */

const { initTestContext } = require('../support/copierSteps')
const { resolvePath } = require('../support/contentSteps')
const { executeCopier, executeCommand, initGitRepo, createInitialCommit } = require('../support/commands')
const { deleteFileIfExists } = require('../support/filesystem')
const { assertFileExists, assertFileContains, assertFileNotContains, assertDirExists } = require('../support/assertions')
const { getTableCells } = require('../support/tables')
const { resolveProjectPath } = require('../support/config')

function register () {
  // Given
  Given('a clean temporary directory for project mode tests', function () { // eslint-disable-line no-undef
    initTestContext(this, 'devsecops', 'project')
  })

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
}

module.exports = { register }
