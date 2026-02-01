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
// const { getTableRows } = require('./tables')

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

  // Default step for devsecops/scaffolding tests
  Given('a generated project from the Copier template', function () { // eslint-disable-line no-undef
    initTestContext(this, 'devsecops', 'scaffolding')
    executeCopier(this.projectRoot)
  })

  // Separate steps for more control
  Given('a clean temporary directory for tests', function () { // eslint-disable-line no-undef
    initTestContext(this, 'devsecops', 'scaffolding')
  })

  Given('the copier command is executed to generate a project from the template', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot)
  })

  Given('a generated project from the Copier template with the following answers:', function (table) { // eslint-disable-line no-undef
    initTestContext(this, 'devsecops', 'custom-answers')
    // const rows = getTableRows(table)
    const answers = {}

    // Check if table has headers, or use raw parsing if needed
    // Assuming simple Key | Value structure without headers checking by getTableRows for now
    // as we want to iterate all rows.

    table.rows.slice(1).forEach(row => {
      const key = row.cells[0].value
      const value = row.cells[1].value
      answers[key] = value
    })

    executeCopier(this.projectRoot, answers)
  })

  // Generic copier execution
  When('the copier command is executed to generate a project from the template', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot)
  })

  When('the copier command is executed with default settings', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot)
  })
}

// Auto-register when loaded by CodeceptJS
register()

module.exports = { register, initTestContext }
