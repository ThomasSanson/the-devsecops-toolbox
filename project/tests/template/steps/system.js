/**
 * System Steps
 *
 * Steps for test infrastructure setup (directories, environment).
 * These are generic steps used across all domains.
 */

const fs = require('fs')
const { initTestContext } = require('../step_objects/copier')
const { executeCopier } = require('../step_objects/commands')
const { resolvePath } = require('../step_objects/content')
const { assertFileContains, assertFileNotContains } = require('../step_objects/assertions')
const { getKeyValuePairs } = require('../step_objects/tables')

function appendContentToFile (context, relativePath, content) {
  const filePath = resolvePath(context, relativePath)
  fs.appendFileSync(filePath, '\n' + content)
}

function normalizeDocStringContent (content) {
  if (typeof content === 'object' && content.content) {
    return content.content
  }

  return content
}

function register () {
  /**
   * Generic step to initialize a clean temporary directory for any domain/feature tests.
   * Format: "domain/feature" or just "domain" (feature defaults to 'default')
   *
   * Examples:
   *   Given a clean temporary directory for "ansible/integration" tests
   *   Given a clean temporary directory for "gitlab/tags" tests
   *   Given a clean temporary directory for "docker/runtime" tests
   */
  Given('a clean temporary directory for {string} tests', function (domainFeature) { // eslint-disable-line no-undef
    const [domain, feature] = domainFeature.split('/')
    initTestContext(this, domain, feature || 'default')
  })

  /**
   * Generic assertion to check file content.
   * Useful for verifying Taskfile definitions, variable names, etc.
   */
  Then('the file {string} should contain {string}', function (relativePath, expectedContent) { // eslint-disable-line no-undef
    const filePath = resolvePath(this, relativePath)
    assertFileContains(filePath, expectedContent)
  })

  Then('the file {string} should NOT contain {string}', function (relativePath, unexpectedContent) { // eslint-disable-line no-undef
    const filePath = resolvePath(this, relativePath)
    assertFileNotContains(filePath, unexpectedContent)
  })

  // Copier execution with data table
  When('the copier command is executed with:', function (table) { // eslint-disable-line no-undef
    // Parse table to key-value pairs using shared helper
    const data = getKeyValuePairs(table)
    executeCopier(this.projectRoot, data, { force: true })
  })

  // Append content to file
  When('I append {string} to the file {string}', function (content, relativePath) { // eslint-disable-line no-undef
    appendContentToFile(this, relativePath, content)
  })

  // Append block content to file (DocString)
  When('I append the following content to the file {string}:', function (relativePath, content) { // eslint-disable-line no-undef
    const contentString = normalizeDocStringContent(content)
    appendContentToFile(this, relativePath, contentString)
  })
}

// Auto-register when loaded by CodeceptJS
register()

module.exports = { register }
