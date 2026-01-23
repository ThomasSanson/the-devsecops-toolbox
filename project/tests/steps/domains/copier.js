/**
 * Copier Domain Steps
 *
 * Steps for testing .config/copier template behavior (scaffolding, commitizen).
 */

const fs = require('fs')
const { resolvePath } = require('../support/contentSteps')
const { assertFileExists } = require('../support/assertions')

function register () {
  // Commitizen assertions
  Then('the commitizen configuration file {string} should exist', function (filePath) { // eslint-disable-line no-undef
    const absPath = resolvePath(this, filePath)
    assertFileExists(absPath, `Commitizen configuration file does not exist: ${absPath}`)
  })

  Then('the commitizen configuration should have the version {string}', function (expectedVersion) { // eslint-disable-line no-undef
    const czConfigPath = resolvePath(this, '.config', 'commitizen', 'cz.yaml')
    assertFileExists(czConfigPath)

    const content = fs.readFileSync(czConfigPath, 'utf8')
    const match = content.match(/version:[ \t]*([^\n]+)/)
    if (!match) {
      throw new Error(`No 'version' key found in commitizen config: ${czConfigPath}`)
    }

    const actualVersion = match[1].trim()
    if (actualVersion !== expectedVersion) {
      throw new Error(`Expected commitizen version '${expectedVersion}', got '${actualVersion}' in ${czConfigPath}`)
    }
  })

  Then('the commitizen "version_files" configuration should NOT contain {string}', function (forbiddenFile) { // eslint-disable-line no-undef
    const czConfigPath = resolvePath(this, '.config', 'commitizen', 'cz.yaml')
    assertFileExists(czConfigPath)

    const content = fs.readFileSync(czConfigPath, 'utf8')
    const match = content.match(/version_files:[ \t]*\n((?:[ \t]*-[ \t]*[^\n]+\n)*)/)
    if (!match) {
      throw new Error(`No 'version_files' key found in commitizen config: ${czConfigPath}`)
    }

    const versionFilesBlock = match[1]
    if (versionFilesBlock.includes(forbiddenFile)) {
      throw new Error(`'version_files' contains forbidden file: ${forbiddenFile}`)
    }
  })
}

module.exports = { register }
