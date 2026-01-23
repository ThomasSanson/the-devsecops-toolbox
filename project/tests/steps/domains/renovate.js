/**
 * Renovate Domain Steps
 *
 * Steps for testing Renovate configuration.
 */

const { initTestContext } = require('../support/copierSteps')

function register () {
  // Given
  Given('a clean temporary directory for renovate tests', function () { // eslint-disable-line no-undef
    initTestContext(this, 'renovate', 'config')
  })
}

module.exports = { register }
