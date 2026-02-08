/**
 * Test Context Store
 *
 * Stores current test metadata (feature/scenario names) captured from
 * CodeceptJS Before hook. This enables meaningful directory names.
 */

// Global state for current test metadata
const currentTest = {
  feature: null,
  scenario: null
}

/**
 * Get the current test metadata
 * @returns {Object} Current test feature and scenario names
 */
function getCurrentTest () {
  return { ...currentTest }
}

/**
 * Set current test metadata (called from Before hook)
 * @param {string} feature - Feature name
 * @param {string} scenario - Scenario name
 */
function setCurrentTest (feature, scenario) {
  currentTest.feature = feature
  currentTest.scenario = scenario
}

/**
 * Clear current test metadata
 */
function clearCurrentTest () {
  currentTest.feature = null
  currentTest.scenario = null
}

module.exports = {
  getCurrentTest,
  setCurrentTest,
  clearCurrentTest
}
