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

// Counters per domain/feature for unique scenario IDs
const scenarioCounters = {}

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
 * Generate a unique scenario ID for a domain/feature combination
 * @param {string} domain - Domain name
 * @param {string} feature - Feature name
 * @returns {string} Unique scenario ID (e.g., "scenario-001")
 */
function generateScenarioId (domain, feature) {
  const key = `${domain}/${feature}`
  if (!scenarioCounters[key]) {
    scenarioCounters[key] = 0
  }
  scenarioCounters[key]++
  return `scenario-${String(scenarioCounters[key]).padStart(3, '0')}`
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

/**
 * Legacy support: Get base path for a domain (deprecated)
 * @param {string} domain - The domain name
 * @returns {string} The base test path
 * @deprecated Use getScenarioPath with context instead
 */
function getBasePath (domain) {
  return path.join(CONFIG.basePath, slugify(domain))
}

module.exports = {
  CONFIG,
  slugify,
  generateScenarioId,
  getScenarioPath,
  getProjectRoot,
  resolveProjectPath,
  getBasePath
}
