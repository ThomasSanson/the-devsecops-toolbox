/**
 * Generic Copier Steps
 *
 * Reusable Given/When steps for Copier template generation.
 * These are the "PageObject" equivalent for test setup.
 */

const { removeDirRecursive, ensureDir } = require('./filesystem')
const { executeCopier } = require('./commands')
const { getProjectRoot, slugify } = require('./config')
const { getCurrentTest } = require('./testContext')

/**
 * Initialize test context with domain and auto-detected scenario name
 */
function initTestContext (context, domain, featureOverride = null) {
  const testMeta = getCurrentTest()

  context.domain = domain
  context.feature = slugify(featureOverride || testMeta.feature || 'default')
  context.scenario = slugify(testMeta.scenario || 'default')

  const projectRoot = getProjectRoot(context)
  removeDirRecursive(projectRoot)
  ensureDir(projectRoot)
  context.projectRoot = projectRoot

  return projectRoot
}

function register () {
  // Generic step: init context + generate project for a specific domain
  Given('a generated project for {string} tests', function (domainFeature) { // eslint-disable-line no-undef
    const [domain, feature] = domainFeature.split('/')
    initTestContext(this, domain, feature || 'default')
    executeCopier(this.projectRoot)
  })

  // Default step for copier/scaffolding tests
  Given('a generated project from the Copier template', function () { // eslint-disable-line no-undef
    initTestContext(this, 'copier', 'scaffolding')
    executeCopier(this.projectRoot)
  })

  // Separate steps for more control
  Given('a clean temporary directory for tests', function () { // eslint-disable-line no-undef
    initTestContext(this, 'copier', 'scaffolding')
  })

  Given('the copier command is executed to generate a project from the template', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot)
  })

  // Generic copier execution
  When('the copier command is executed to generate a project from the template', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot)
  })

  When('the copier command is executed with default settings', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot)
  })
}

module.exports = { register, initTestContext }
