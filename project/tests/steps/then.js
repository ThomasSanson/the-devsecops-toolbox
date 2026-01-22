/**
 * Shared Then Steps
 *
 * Generic Then step definitions reusable by all domains.
 * Uses test context (this) to get the project root for isolated testing.
 */

const fs = require('fs')
const path = require('path')
const {
  assertFileExists,
  assertFileNotExists,
  assertDirExists,
  assertDirNotExists,
  assertFileContains,
  assertFileNotContains,
  compareFileContent
} = require('./support/assertions')
const { getTableRows, getTableCells } = require('./support/tables')

/**
 * Resolve a path relative to the project root from context
 * @param {Object} context - Test context (this)
 * @param {...string} parts - Path segments
 * @returns {string} Resolved path
 */
function resolvePath (context, ...parts) {
  return path.join(context.projectRoot, ...parts)
}

function register () {
  // Directory assertions
  Then('the generated project directory should exist', function () { // eslint-disable-line no-undef
    assertDirExists(this.projectRoot)
  })

  Then('the {string} directory should exist', function (dirName) { // eslint-disable-line no-undef
    assertDirExists(resolvePath(this, dirName))
  })

  Then('the {string} directory should NOT exist', function (dirName) { // eslint-disable-line no-undef
    assertDirNotExists(resolvePath(this, dirName))
  })

  Then('the following directories should NOT exist:', function (table) { // eslint-disable-line no-undef
    const dirPaths = getTableRows(table, 'Directory Path')
    dirPaths.forEach(relPath => {
      assertDirNotExists(resolvePath(this, relPath))
    })
  })

  // File assertions
  Then('the {string} file should exist', function (filePath) { // eslint-disable-line no-undef
    assertFileExists(resolvePath(this, filePath))
  })

  Then('the {string} file should NOT exist', function (filePath) { // eslint-disable-line no-undef
    assertFileNotExists(resolvePath(this, filePath))
  })

  Then('the {string} file should exist in the {string} directory', function (fileName, dirPath) { // eslint-disable-line no-undef
    assertFileExists(resolvePath(this, dirPath, fileName))
  })

  Then('the following files should NOT exist:', function (table) { // eslint-disable-line no-undef
    const filePaths = getTableRows(table, 'File Path')
    filePaths.forEach(relPath => {
      assertFileNotExists(resolvePath(this, relPath))
    })
  })

  // File content assertions
  Then('the content of the file {string} should be exactly:', function (filePath, contentBlock) { // eslint-disable-line no-undef
    const absPath = resolvePath(this, filePath)
    assertFileExists(absPath)
    compareFileContent(absPath, contentBlock)
  })

  Then('the content of the file {string} should contain:', function (filePath, contentBlock) { // eslint-disable-line no-undef
    const absPath = resolvePath(this, filePath)
    assertFileExists(absPath)
    assertFileContains(absPath, contentBlock)
  })

  Then('the file {string} should NOT contain any blank lines', function (filePath) { // eslint-disable-line no-undef
    const absPath = resolvePath(this, filePath)
    assertFileExists(absPath)
    const content = fs.readFileSync(absPath, 'utf8')
    if (content.includes('\n\n')) {
      throw new Error(`File ${filePath} contains at least one blank line (double newline)`)
    }
  })

  Then('the file {string} should NOT contain double blank lines', function (filePath) { // eslint-disable-line no-undef
    const absPath = resolvePath(this, filePath)
    assertFileExists(absPath)
    const content = fs.readFileSync(absPath, 'utf8')
    // Triple newline means two blank lines in a row
    if (content.includes('\n\n\n')) {
      throw new Error(`File ${filePath} contains at least one double blank line (triple newline)`)
    }
  })

  Then('the "includes" section of {string} should NOT contain any blank lines', function (filePath) { // eslint-disable-line no-undef
    const absPath = resolvePath(this, filePath)
    assertFileExists(absPath)
    const content = fs.readFileSync(absPath, 'utf8')
    const includesMatch = content.match(/includes:[\s\S]*?(?=tasks:|$)/)
    if (includesMatch) {
      const includesContent = includesMatch[0].trim()
      if (includesContent.includes('\n\n')) {
        throw new Error(`The "includes" section of ${filePath} contains blank lines.`)
      }
    }
  })

  // Commitizen assertions
  Then('the commitizen configuration file {string} should exist', function (filePath) { // eslint-disable-line no-undef
    const absPath = resolvePath(this, filePath)
    assertFileExists(absPath, `Commitizen configuration file does not exist: ${absPath}`)
  })

  Then('the commitizen configuration should have the version {string}', function (expectedVersion) { // eslint-disable-line no-undef
    const czConfigPath = resolvePath(this, '.config', 'commitizen', 'cz.yaml')
    assertFileExists(czConfigPath)

    const content = fs.readFileSync(czConfigPath, 'utf8')
    const match = content.match(/version:[ \t]*([^\n]+)/)
    if (!match) {
      throw new Error(`No 'version' key found in commitizen config: ${czConfigPath}`)
    }

    const actualVersion = match[1].trim()
    if (actualVersion !== expectedVersion) {
      throw new Error(`Expected commitizen version '${expectedVersion}', got '${actualVersion}' in ${czConfigPath}`)
    }
  })

  Then('the commitizen "version_files" configuration should NOT contain {string}', function (forbiddenFile) { // eslint-disable-line no-undef
    const czConfigPath = resolvePath(this, '.config', 'commitizen', 'cz.yaml')
    assertFileExists(czConfigPath)

    const content = fs.readFileSync(czConfigPath, 'utf8')
    const match = content.match(/version_files:[ \t]*\n((?:[ \t]*-[ \t]*[^\n]+\n)*)/)
    if (!match) {
      throw new Error(`No 'version_files' key found in commitizen config: ${czConfigPath}`)
    }

    const versionFilesBlock = match[1]
    if (versionFilesBlock.includes(forbiddenFile)) {
      throw new Error(`'version_files' contains forbidden file: ${forbiddenFile}`)
    }
  })

  // DevSecOps task assertion
  Then('the DevSecOps task should complete successfully', function () { // eslint-disable-line no-undef
    if (this.testError) {
      throw new Error(
        `DevSecOps task failed to execute in the generated project:\n${this.testError}\nOutput:\n${this.testResult}`
      )
    }
  })

  // Ansible specific assertions
  Then('the Taskfile should include the Ansible taskfile reference', function () { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, 'Taskfile.yml')
    assertFileContains(taskfilePath, 'ansible:\n    taskfile: .config/ansible/Taskfile.yml')
  })

  Then('the Taskfile should NOT include the Ansible taskfile reference', function () { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, 'Taskfile.yml')
    assertFileNotContains(taskfilePath, 'ansible:')
  })

  // Project mode specific assertions
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

  // GitLab CI specific assertions
  Then('the GitLab CI tags configuration should exist', function () { // eslint-disable-line no-undef
    const tagsPath = resolvePath(this, '.config/gitlab/ci/tags.yml')
    assertFileExists(tagsPath, `GitLab CI tags configuration not found: ${tagsPath}`)
  })

  Then('the GitLab CI tags should include {string}', function (expectedTag) { // eslint-disable-line no-undef
    const tagsPath = resolvePath(this, '.config/gitlab/ci/tags.yml')
    assertFileContains(tagsPath, expectedTag)
  })

  Then('the GitLab CI tags should be empty', function () { // eslint-disable-line no-undef
    const tagsPath = resolvePath(this, '.config/gitlab/ci/tags.yml')
    assertFileExists(tagsPath)

    const content = fs.readFileSync(tagsPath, 'utf8')
    // Check that there are no tags defined under the .default-tags section
    // The file should have an empty tags section or no tag values
    const hasTagValues = /tags:\s*\n\s+-\s+\S+/.test(content)
    if (hasTagValues) {
      throw new Error(`Expected GitLab CI tags to be empty, but found tags defined in ${tagsPath}`)
    }
  })

  Then('the GitLab CI code jobs should use SaaS runner tags', function () { // eslint-disable-line no-undef
    const codeYmlPath = resolvePath(this, '.config/gitlab/ci/devsecops/code.yml')
    assertFileContains(codeYmlPath, 'saas-linux-medium-amd64')
  })

  Then('the GitLab CI code jobs should NOT have hardcoded runner tags', function () { // eslint-disable-line no-undef
    const codeYmlPath = resolvePath(this, '.config/gitlab/ci/devsecops/code.yml')
    assertFileNotContains(codeYmlPath, 'saas-linux-medium-amd64')
  })

  // GitLab Proxy specific assertions
  Then('the GitLab CI variables should NOT contain proxy configuration', function () { // eslint-disable-line no-undef
    const variablesPath = resolvePath(this, '.config/gitlab/ci/variables.yml')
    assertFileNotContains(variablesPath, 'HTTP_PROXY')
    assertFileNotContains(variablesPath, 'HTTPS_PROXY')
  })

  Then('the GitLab CI variables should contain HTTP_PROXY {string}', function (proxyUrl) { // eslint-disable-line no-undef
    const variablesPath = resolvePath(this, '.config/gitlab/ci/variables.yml')
    assertFileContains(variablesPath, `HTTP_PROXY: "${proxyUrl}"`)
  })

  Then('the GitLab CI variables should contain HTTPS_PROXY {string}', function (proxyUrl) { // eslint-disable-line no-undef
    const variablesPath = resolvePath(this, '.config/gitlab/ci/variables.yml')
    assertFileContains(variablesPath, `HTTPS_PROXY: "${proxyUrl}"`)
  })

  Then('the {string} file should contain proxy variables', function (fileName) { // eslint-disable-line no-undef
    const filePath = resolvePath(this, fileName)
    assertFileContains(filePath, 'HTTP_PROXY')
  })

  Then('the {string} file should NOT contain proxy variables', function (fileName) { // eslint-disable-line no-undef
    const filePath = resolvePath(this, fileName)
    assertFileNotContains(filePath, 'HTTP_PROXY')
  })

  // Container runtime specific assertions
  Then('the root Taskfile should include the docker-ce taskfile reference', function () { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, 'Taskfile.yml')
    assertFileContains(taskfilePath, 'docker-ce:\n    taskfile: .config/docker-ce/Taskfile.yml')
  })

  Then('the root Taskfile should NOT include the docker-ce taskfile reference', function () { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, 'Taskfile.yml')
    assertFileNotContains(taskfilePath, 'docker-ce:')
  })

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
