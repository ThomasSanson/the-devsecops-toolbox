/**
 * Assertion utilities for the test suite
 *
 * Provides common assertion functions for file and directory validation.
 */

const { readFileNormalized, isFile, isDirectory } = require('./filesystem')

/**
 * Normalize content for comparison
 * @param {*} content - Content to normalize
 * @returns {string} Normalized content
 */
function normalizeContent (content) {
  if (content && typeof content === 'object' && typeof content.content === 'string') {
    return content.content.replace(/\r\n/g, '\n').trim()
  }
  if (Array.isArray(content)) {
    return content.map(l => l.trimEnd()).join('\n').replace(/\r\n/g, '\n').trim()
  }
  return String(content).replace(/\r\n/g, '\n').trim()
}

/**
 * Assert that a file exists
 * @param {string} filePath - Path to the file
 * @param {string} [errorMessage] - Custom error message
 * @returns {boolean} True if assertion passes
 */
function assertFileExists (filePath, errorMessage = null) {
  if (!isFile(filePath)) {
    throw new Error(errorMessage || `File does not exist: ${filePath}`)
  }
  return true
}

/**
 * Assert that a file does not exist
 * @param {string} filePath - Path to the file
 * @returns {boolean} True if assertion passes
 */
function assertFileNotExists (filePath) {
  if (isFile(filePath)) {
    throw new Error(`File should NOT exist: ${filePath}`)
  }
  return true
}

/**
 * Assert that a directory exists
 * @param {string} dirPath - Path to the directory
 * @param {string} [errorMessage] - Custom error message
 * @returns {boolean} True if assertion passes
 */
function assertDirExists (dirPath, errorMessage = null) {
  if (!isDirectory(dirPath)) {
    throw new Error(errorMessage || `Directory does not exist: ${dirPath}`)
  }
  return true
}

/**
 * Assert that a directory does not exist
 * @param {string} dirPath - Path to the directory
 * @returns {boolean} True if assertion passes
 */
function assertDirNotExists (dirPath) {
  if (isDirectory(dirPath)) {
    throw new Error(`Directory should NOT exist: ${dirPath}`)
  }
  return true
}

/**
 * Assert that a file contains expected content
 * @param {string} filePath - Path to the file
 * @param {*} expected - Expected content (string, array, or object with content property)
 * @returns {boolean} True if assertion passes
 */
function assertFileContains (filePath, expected) {
  const actual = readFileNormalized(filePath)
  const normalizedExpected = normalizeContent(expected)

  if (!actual.includes(normalizedExpected)) {
    console.log('---DEBUG FILE CONTAINS---')
    console.log('ACTUAL:[' + actual.split('\n').map(l => JSON.stringify(l)).join(',') + ']')
    console.log('EXPECTED SUBSTRING:[' + normalizedExpected.split('\n').map(l => JSON.stringify(l)).join(',') + ']')
    throw new Error(`File content does not contain expected snippet for ${filePath}\n--- Expected snippet ---\n${normalizedExpected}`)
  }
  return true
}

/**
 * Assert that a file does not contain certain content
 * @param {string} filePath - Path to the file
 * @param {*} unexpected - Content that should not be present
 * @returns {boolean} True if assertion passes
 */
function assertFileNotContains (filePath, unexpected) {
  assertFileExists(filePath)
  const actual = readFileNormalized(filePath)
  const normalizedUnexpected = normalizeContent(unexpected)

  if (actual.includes(normalizedUnexpected)) {
    throw new Error(`File should NOT contain the following content: ${filePath}\n--- Unexpected content ---\n${normalizedUnexpected}`)
  }
  return true
}

/**
 * Compare file content exactly with expected content
 * @param {string} filePath - Path to the file
 * @param {*} expected - Expected content
 * @returns {boolean} True if assertion passes
 */
function compareFileContent (filePath, expected) {
  const actual = readFileNormalized(filePath).trim()
  const normalizedExpected = normalizeContent(expected)

  if (actual !== normalizedExpected) {
    console.log('---DEBUG FILE CONTENT---')
    console.log('ACTUAL:[' + actual.split('\n').map(l => JSON.stringify(l)).join(',') + ']')
    console.log('EXPECTED:[' + normalizedExpected.split('\n').map(l => JSON.stringify(l)).join(',') + ']')
    throw new Error(`File content mismatch for ${filePath}\n--- Actual ---\n${actual}\n--- Expected ---\n${normalizedExpected}`)
  }

  return true
}

module.exports = {
  normalizeContent,
  assertFileExists,
  assertFileNotExists,
  assertDirExists,
  assertDirNotExists,
  assertFileContains,
  assertFileNotContains,
  compareFileContent
}
