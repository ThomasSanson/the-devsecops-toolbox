/**
 * Generic Content Steps
 *
 * Reusable Then steps for file/directory assertions.
 * These are the "PageObject" equivalent for assertions.
 */

const fs = require('fs')
const path = require('path')
const {
  assertFileExists,
  assertFileNotExists,
  assertDirExists,
  assertDirNotExists,
  assertFileContains,
  compareFileContent,
  assertDirContainsSubdirs
} = require('./assertions')
const { getTableRows, getTableCells } = require('./tables')

/**
 * Resolve a path relative to the project root from context
 */
function resolvePath (context, ...parts) {
  return path.join(context.projectRoot, ...parts)
}

function register () {
  // Directory assertions
  Then('the generated project directory should exist', function () { // eslint-disable-line no-undef
    assertDirExists(this.projectRoot)
  })

  Then('the {string} directory should exist', function (dirName) { // eslint-disable-line no-undef
    assertDirExists(resolvePath(this, dirName))
  })

  Then('the {string} directory should NOT exist', function (dirName) { // eslint-disable-line no-undef
    assertDirNotExists(resolvePath(this, dirName))
  })

  Then('the following directories should NOT exist:', function (table) { // eslint-disable-line no-undef
    const dirPaths = getTableRows(table, 'Directory Path')
    dirPaths.forEach(relPath => {
      assertDirNotExists(resolvePath(this, relPath))
    })
  })

  Then('the {string} directory should contain the following subdirectories:', function (dirPath, table) { // eslint-disable-line no-undef
    const subdirs = getTableCells(table, 0)
    assertDirContainsSubdirs(resolvePath(this, dirPath), subdirs)
  })

  // File assertions
  Then('the {string} file should exist', function (filePath) { // eslint-disable-line no-undef
    assertFileExists(resolvePath(this, filePath))
  })

  Then('the {string} file should NOT exist', function (filePath) { // eslint-disable-line no-undef
    assertFileNotExists(resolvePath(this, filePath))
  })

  Then('the {string} file should exist in the {string} directory', function (fileName, dirPath) { // eslint-disable-line no-undef
    assertFileExists(resolvePath(this, dirPath, fileName))
  })

  Then('the following files should NOT exist:', function (table) { // eslint-disable-line no-undef
    const filePaths = getTableRows(table, 'File Path')
    filePaths.forEach(relPath => {
      assertFileNotExists(resolvePath(this, relPath))
    })
  })

  // File content assertions
  Then('the content of the file {string} should be exactly:', function (filePath, contentBlock) { // eslint-disable-line no-undef
    const absPath = resolvePath(this, filePath)
    assertFileExists(absPath)
    compareFileContent(absPath, contentBlock)
  })

  Then('the content of the file {string} should contain:', function (filePath, contentBlock) { // eslint-disable-line no-undef
    const absPath = resolvePath(this, filePath)
    assertFileExists(absPath)
    assertFileContains(absPath, contentBlock)
  })

  Then('the file {string} should NOT contain any blank lines', function (filePath) { // eslint-disable-line no-undef
    const absPath = resolvePath(this, filePath)
    assertFileExists(absPath)
    const content = fs.readFileSync(absPath, 'utf8')
    if (content.includes('\n\n')) {
      throw new Error(`File ${filePath} contains at least one blank line (double newline)`)
    }
  })

  Then('the file {string} should NOT contain double blank lines', function (filePath) { // eslint-disable-line no-undef
    const absPath = resolvePath(this, filePath)
    assertFileExists(absPath)
    const content = fs.readFileSync(absPath, 'utf8')
    if (content.includes('\n\n\n')) {
      throw new Error(`File ${filePath} contains at least one double blank line (triple newline)`)
    }
  })

  Then('the "includes" section of {string} should NOT contain any blank lines', function (filePath) { // eslint-disable-line no-undef
    const absPath = resolvePath(this, filePath)
    assertFileExists(absPath)
    const content = fs.readFileSync(absPath, 'utf8')
    const includesMatch = content.match(/includes:[\s\S]*?(?=tasks:|$)/)
    if (includesMatch) {
      const includesContent = includesMatch[0].trim()
      if (includesContent.includes('\n\n')) {
        throw new Error(`The "includes" section of ${filePath} contains blank lines.`)
      }
    }
  })
}

// Auto-register when loaded by CodeceptJS
register()

module.exports = { register, resolvePath }
