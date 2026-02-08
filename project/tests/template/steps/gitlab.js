/**
 * GitLab Domain Steps
 *
 * Steps for testing GitLab CI tags configuration.
 */

const fs = require('fs')
const { resolvePath } = require('../step_objects/content')
const { executeCopier } = require('../step_objects/commands')
const { assertFileExists, assertFileContains, assertFileNotContains } = require('../step_objects/assertions')

function register () {
  // Given - Tags
  Given('a project was generated with CI platform {string}', function (ciPlatform) { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { ci_platform: ciPlatform })
  })

  // When - CI Platform
  When('the copier command is executed with CI platform {string}', function (ciPlatform) { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { ci_platform: ciPlatform })
  })

  When('the project is updated with CI platform {string}', function (ciPlatform) { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { ci_platform: ciPlatform }, { force: true })
  })

  // Then - Tags
  Then('the GitLab CI tags configuration should exist', function () { // eslint-disable-line no-undef
    const tagsPath = resolvePath(this, '.config/gitlab/ci/tags.yml')
    assertFileExists(tagsPath, `GitLab CI tags configuration not found: ${tagsPath}`)
  })

  Then('the GitLab CI tags should include {string}', function (expectedTag) { // eslint-disable-line no-undef
    const tagsPath = resolvePath(this, '.config/gitlab/ci/tags.yml')
    assertFileContains(tagsPath, expectedTag)
  })

  Then('the GitLab CI tags should be empty', function () { // eslint-disable-line no-undef
    const tagsPath = resolvePath(this, '.config/gitlab/ci/tags.yml')
    assertFileExists(tagsPath)

    const content = fs.readFileSync(tagsPath, 'utf8')
    const hasTagValues = /tags:\s*\n\s+-\s+\S+/.test(content)
    if (hasTagValues) {
      throw new Error(`Expected GitLab CI tags to be empty, but found tags defined in ${tagsPath}`)
    }
  })

  Then('the GitLab CI code jobs should use SaaS runner tags', function () { // eslint-disable-line no-undef
    const codeYmlPath = resolvePath(this, '.config/gitlab/ci/devsecops/code.yml')
    assertFileContains(codeYmlPath, 'saas-linux-medium-amd64')
  })

  Then('the GitLab CI code jobs should NOT have hardcoded runner tags', function () { // eslint-disable-line no-undef
    const codeYmlPath = resolvePath(this, '.config/gitlab/ci/devsecops/code.yml')
    assertFileNotContains(codeYmlPath, 'saas-linux-medium-amd64')
  })

  Then('the GitLab CI variables should contain {string}', function (content) { // eslint-disable-line no-undef
    const variablesPath = resolvePath(this, '.config/gitlab/ci/variables.yml')
    assertFileContains(variablesPath, content)
  })

  Then('the GitLab CI variables should NOT contain {string}', function (content) { // eslint-disable-line no-undef
    const variablesPath = resolvePath(this, '.config/gitlab/ci/variables.yml')
    assertFileNotContains(variablesPath, content)
  })
}

// Auto-register when loaded by CodeceptJS
register()

module.exports = { register }
