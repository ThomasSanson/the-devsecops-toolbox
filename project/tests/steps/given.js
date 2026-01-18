/**
 * Shared Given Steps
 *
 * Generic Given step definitions reusable by all domains.
 * Each scenario gets its own isolated directory for parallelism and better DX.
 *
 * Directory structure: tmp/tests/{domain}/{feature}/{scenario-slug}/
 */

const { removeDirRecursive, ensureDir } = require('./support/filesystem')
const { executeCommand, executeCopier, initGitRepo, createInitialCommit } = require('./support/commands')
const { assertDirExists, assertFileExists } = require('./support/assertions')
const { getProjectRoot, resolveProjectPath, slugify } = require('./support/config')
const { getCurrentTest } = require('./support/testContext')

/**
 * Initialize test context with domain and auto-detected scenario name
 *
 * Uses the Before hook's captured test metadata to get the actual
 * Gherkin scenario name, which is then slugified for the directory.
 *
 * @param {Object} context - The test context (this)
 * @param {string} domain - The domain name (e.g., 'copier', 'ansible')
 * @param {string} [featureOverride] - Optional feature name override
 */
function initTestContext (context, domain, featureOverride = null) {
  // Get scenario name from Before hook (captured via testContext)
  const testMeta = getCurrentTest()

  context.domain = domain
  // Use captured feature/scenario names, slugified for directory names
  context.feature = slugify(featureOverride || testMeta.feature || 'default')
  context.scenario = slugify(testMeta.scenario || 'default')

  // Create isolated directory for this scenario
  const projectRoot = getProjectRoot(context)
  removeDirRecursive(projectRoot)
  ensureDir(projectRoot)
  context.projectRoot = projectRoot

  return projectRoot
}

function register () {
  // Parameterized step: init context + generate project for a specific domain
  // Usage: Given a generated project for "renovate/config" tests
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

  Given('a clean temporary directory for Ansible tests', function () { // eslint-disable-line no-undef
    initTestContext(this, 'ansible', 'integration')
  })

  Given('a clean temporary directory for project mode tests', function () { // eslint-disable-line no-undef
    initTestContext(this, 'devsecops', 'project')
  })

  Given('a project has been generated with the DevSecOps toolbox', function () { // eslint-disable-line no-undef
    if (!this.projectRoot) {
      initTestContext(this, 'copier', 'scaffolding')
    }

    const projectRoot = this.projectRoot

    executeCopier(projectRoot)
    assertDirExists(projectRoot, `Project directory does not exist after generation: ${projectRoot}`)

    // Initialize git repository
    initGitRepo(projectRoot, { branch: 'origin/main' })
    createInitialCommit(projectRoot, { message: 'feat: init', tag: '0.1.0' })

    // Verify DevSecOps taskfile exists
    const taskfile = resolveProjectPath(this, '.config', 'devsecops', 'Taskfile.test.yml')
    assertFileExists(taskfile, `DevSecOps Taskfile.test.yml not found: ${taskfile}`)
  })

  // Ansible specific
  Given('a project was generated with Ansible enabled', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { ansible_enabled: true })
  })

  Given('a project was generated with Ansible disabled', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { ansible_enabled: false })
  })

  // Project mode specific
  Given('a project was generated with project mode enabled', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { project_enabled: true })
  })

  Given('a project was generated with project mode disabled', function () { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { project_enabled: false })
  })

  // GitLab specific
  Given('a clean temporary directory for GitLab tags tests', function () { // eslint-disable-line no-undef
    initTestContext(this, 'gitlab', 'tags')
  })

  Given('a project was generated with CI platform {string}', function (ciPlatform) { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { ci_platform: ciPlatform })
  })

  // Git initialization with origin/main ref for DevSecOps tools compatibility
  Given('the project is initialized as a git repository', function () { // eslint-disable-line no-undef
    initGitRepo(this.projectRoot, { branch: 'main' })
    createInitialCommit(this.projectRoot, { message: 'feat: initial commit', tag: '0.1.0' })

    // Create origin/main ref to satisfy gitleaks and commitlint
    // These tools compare against origin/main which doesn't exist in a local-only repo
    executeCommand('git update-ref refs/remotes/origin/main HEAD', { cwd: this.projectRoot })
  })
}

module.exports = { register, initTestContext }
