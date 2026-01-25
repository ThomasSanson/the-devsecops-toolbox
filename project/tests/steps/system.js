/**
 * System Steps
 *
 * Steps for test infrastructure setup (directories, environment).
 * These are generic steps used across all domains.
 */

const { initTestContext } = require('../step_objects/copier')

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
    const { resolvePath } = require('../step_objects/content')
    const { assertFileContains } = require('../step_objects/assertions')
    const filePath = resolvePath(this, relativePath)
    assertFileContains(filePath, expectedContent)
  })

  Then('the file {string} should NOT contain {string}', function (relativePath, unexpectedContent) { // eslint-disable-line no-undef
    const { resolvePath } = require('../step_objects/content')
    const { assertFileNotContains } = require('../step_objects/assertions')
    const filePath = resolvePath(this, relativePath)
    assertFileNotContains(filePath, unexpectedContent)
  })
}

// Auto-register when loaded by CodeceptJS
register()

module.exports = { register }
