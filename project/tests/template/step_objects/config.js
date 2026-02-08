/**
 * Configuration constants for the test suite
 *
 * Provides centralized configuration for all test domains.
 * Supports isolated test directories per scenario for parallelism and better DX.
 *
 * Structure: tmp/tests/{domain}/{feature}/{scenario-NNN}/
 *
 * Note: Scenario names are generated with incremental IDs because CodeceptJS
 * running via npx doesn't provide access to test metadata in step definitions.
 * When CodeceptJS is installed locally, scenario names can be slugified from
 * the actual Gherkin scenario titles.
 */

const path = require('path')

const CONFIG = {
  basePath: path.join('tmp', 'tests'),
  maxSlugLength: 80
}

/**
 * Slugify a string for use as a directory name
 * @param {string} str - String to slugify
 * @returns {string} Slugified string
 */
function slugify (str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, CONFIG.maxSlugLength)
}

/**
 * Build the test path for a specific scenario
 * Structure: tmp/tests/{domain}/{feature}/{scenario-slug}/
 *
 * @param {Object} context - Test context object (this)
 * @returns {string} The scenario test path
 */
function getScenarioPath (context) {
  const domain = context.domain || 'default'
  const feature = context.feature || 'default'
  const scenario = context.scenario || 'default'

  return path.join(
    CONFIG.basePath,
    slugify(domain),
    slugify(feature),
    slugify(scenario)
  )
}

/**
 * Get the project root path for the current scenario
 * @param {Object} context - Test context object (this)
 * @returns {string} The project root path
 */
function getProjectRoot (context) {
  return getScenarioPath(context)
}

/**
 * Resolve a path relative to the project root
 * @param {Object} context - Test context object (this)
 * @param {...string} parts - Path segments to join
 * @returns {string} The resolved path
 */
function resolveProjectPath (context, ...parts) {
  return path.join(getProjectRoot(context), ...parts)
}

module.exports = {
  CONFIG,
  slugify,
  getScenarioPath,
  getProjectRoot,
  resolveProjectPath
}
