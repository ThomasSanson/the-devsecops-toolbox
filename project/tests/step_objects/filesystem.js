/**
 * Filesystem utilities for the test suite
 *
 * Provides common file and directory operations.
 */

const fs = require('fs')
const { execSync } = require('child_process')

/**
 * Remove a directory recursively
 * @param {string} dirPath - Path to the directory to remove
 */
function removeDirRecursive (dirPath) {
  try {
    execSync(`rm -rf "${dirPath}"`)
  } catch (err) {
    throw new Error(`Failed to remove directory ${dirPath}: ${err.message}`)
  }
}

/**
 * Ensure a directory exists, creating it if necessary
 * @param {string} dirPath - Path to the directory
 */
function ensureDir (dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

/**
 * Read file content as normalized string (Unix line endings)
 * @param {string} filePath - Path to the file
 * @returns {string} Normalized file content
 */
function readFileNormalized (filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')
}

/**
 * Check if a path exists and is a file
 * @param {string} filePath - Path to check
 * @returns {boolean} True if the path is a file
 */
function isFile (filePath) {
  return fs.existsSync(filePath) && fs.lstatSync(filePath).isFile()
}

/**
 * Check if a path exists and is a directory
 * @param {string} dirPath - Path to check
 * @returns {boolean} True if the path is a directory
 */
function isDirectory (dirPath) {
  return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()
}

/**
 * Delete a file if it exists
 * @param {string} filePath - Path to the file
 */
function deleteFileIfExists (filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}

module.exports = {
  removeDirRecursive,
  ensureDir,
  readFileNormalized,
  isFile,
  isDirectory,
  deleteFileIfExists
}
