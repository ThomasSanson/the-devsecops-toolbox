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
}

// Auto-register when loaded by CodeceptJS
register()

module.exports = { register }
