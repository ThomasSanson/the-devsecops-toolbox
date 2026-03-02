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

  // Test coverage script steps
  Given('a minimal project with test tasks and matching CI jobs', function () { // eslint-disable-line no-undef
    initTestContext(this, 'devsecops', 'test-coverage-script')
    const root = this.projectRoot

    // project/Taskfile.yml with project:test:tdd referencing test suites
    ensureDir(path.join(root, 'project'))
    fs.writeFileSync(path.join(root, 'project', 'Taskfile.yml'), [
      '---',
      "version: '3'",
      'tasks:',
      '  project:test:tdd:',
      '    cmds:',
      '      - task: deploy',
      '      - task: project:test:template',
      '      - task: project:test:gitlab',
      ''
    ].join('\n'))

    // .config/devsecops/Taskfile.test.yml with default referencing checks
    ensureDir(path.join(root, '.config', 'devsecops'))
    fs.writeFileSync(path.join(root, '.config', 'devsecops', 'Taskfile.test.yml'), [
      '---',
      "version: '3'",
      'tasks:',
      '  default:',
      '    cmds:',
      '      - task: check:build-coverage',
      '      - task: check:test-coverage',
      '      - task: :project:test',
      ''
    ].join('\n'))

    // .config/gitlab/ci/devsecops/test.yml with matching CI jobs
    ensureDir(path.join(root, '.config', 'gitlab', 'ci', 'devsecops'))
    fs.writeFileSync(path.join(root, '.config', 'gitlab', 'ci', 'devsecops', 'test.yml'), [
      '---',
      'test:build-coverage:',
      '  script:',
      '    - task devsecops:test:check:build-coverage',
      'test:check-test-coverage:',
      '  script:',
      '    - task devsecops:test:check:test-coverage',
      'test:template:',
      '  script:',
      '    - task project:test:template',
      'test:gitlab:',
      '  script:',
      '    - task project:test:clean',
      '    - task deploy',
      '    - task project:test:gitlab',
      ''
    ].join('\n'))
  })

  Given('a minimal project with a test task missing from CI', function () { // eslint-disable-line no-undef
    initTestContext(this, 'devsecops', 'test-coverage-script')
    const root = this.projectRoot

    // project/Taskfile.yml with an extra test suite (project:test:security) not covered by CI
    ensureDir(path.join(root, 'project'))
    fs.writeFileSync(path.join(root, 'project', 'Taskfile.yml'), [
      '---',
      "version: '3'",
      'tasks:',
      '  project:test:tdd:',
      '    cmds:',
      '      - task: deploy',
      '      - task: project:test:template',
      '      - task: project:test:gitlab',
      '      - task: project:test:security',
      ''
    ].join('\n'))

    // .config/devsecops/Taskfile.test.yml
    ensureDir(path.join(root, '.config', 'devsecops'))
    fs.writeFileSync(path.join(root, '.config', 'devsecops', 'Taskfile.test.yml'), [
      '---',
      "version: '3'",
      'tasks:',
      '  default:',
      '    cmds:',
      '      - task: check:build-coverage',
      '      - task: check:test-coverage',
      '      - task: :project:test',
      ''
    ].join('\n'))

    // .config/gitlab/ci/devsecops/test.yml — missing test:security job
    ensureDir(path.join(root, '.config', 'gitlab', 'ci', 'devsecops'))
    fs.writeFileSync(path.join(root, '.config', 'gitlab', 'ci', 'devsecops', 'test.yml'), [
      '---',
      'test:build-coverage:',
      '  script:',
      '    - task devsecops:test:check:build-coverage',
      'test:check-test-coverage:',
      '  script:',
      '    - task devsecops:test:check:test-coverage',
      'test:template:',
      '  script:',
      '    - task project:test:template',
      'test:gitlab:',
      '  script:',
      '    - task project:test:clean',
      '    - task deploy',
      '    - task project:test:gitlab',
      ''
    ].join('\n'))
  })

  When('the test coverage check is executed', function () { // eslint-disable-line no-undef
    const { execSync } = require('child_process')
    const scriptPath = path.resolve(process.cwd(), '.config/devsecops/scripts/check-test-coverage.sh')
    const cmd = `PROJECT_ROOT=${this.projectRoot} bash ${scriptPath}`
    try {
      this.testCoverageOutput = execSync(cmd, { encoding: 'utf8' })
      this.testCoverageError = null
    } catch (err) {
      this.testCoverageError = err
      this.testCoverageOutput = (err.stdout || '') + (err.stderr || '')
    }
  })

  Then('the test coverage check should succeed', function () { // eslint-disable-line no-undef
    if (this.testCoverageError) {
      throw new Error(
        `Test coverage check failed unexpectedly:\n${this.testCoverageOutput}`
      )
    }
  })

  Then('the test coverage check should fail', function () { // eslint-disable-line no-undef
    if (!this.testCoverageError) {
      throw new Error('Test coverage check should have failed but succeeded')
    }
  })

  Then('the test coverage output should contain {string}', function (expected) { // eslint-disable-line no-undef
    if (!this.testCoverageOutput || !this.testCoverageOutput.includes(expected)) {
      throw new Error(
        `Expected output to contain "${expected}" but got:\n${this.testCoverageOutput}`
      )
    }
  })

  // CodeceptJS Dockerfile steps
  Given('the CodeceptJS Dockerfile exists', function () { // eslint-disable-line no-undef
    const dockerfilePath = path.resolve(process.cwd(), '.config/codeceptjs/Dockerfile')
    assertFileExists(dockerfilePath)
    this.codeceptjsDockerfilePath = dockerfilePath
  })

  Then('the CodeceptJS Dockerfile should contain {string}', function (expected) { // eslint-disable-line no-undef
    assertFileContains(this.codeceptjsDockerfilePath, expected)
  })

  Then('the CodeceptJS Dockerfile should NOT contain {string}', function (unexpected) { // eslint-disable-line no-undef
    assertFileNotContains(this.codeceptjsDockerfilePath, unexpected)
  })

  // Source template file steps
  Then('the source template file {string} should contain {string}', function (filePath, expected) { // eslint-disable-line no-undef
    const absPath = path.resolve(process.cwd(), filePath)
    assertFileExists(absPath)
    assertFileContains(absPath, expected)
  })
}

// Auto-register when loaded by CodeceptJS
register()

module.exports = { register }
