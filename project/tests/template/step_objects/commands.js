/**
 * Command execution utilities for the test suite
 *
 * Provides functions to execute shell commands.
 */

const { execSync } = require('child_process')

/**
 * Execute a shell command
 * @param {string} cmd - Command to execute
 * @param {Object} options - Options
 * @param {string} [options.cwd] - Working directory
 * @param {boolean} [options.silent] - If true, capture output instead of inheriting stdio
 * @returns {string|undefined} Command output if silent mode, undefined otherwise
 */
function executeCommand (cmd, options = {}) {
  const { cwd, silent } = options
  try {
    if (silent) {
      return execSync(cmd, {
        encoding: 'utf8',
        ...(cwd ? { cwd } : {})
      })
    }
    execSync(cmd, { stdio: 'inherit', ...(cwd ? { cwd } : {}) })
  } catch (err) {
    throw new Error(`Failed to run command '${cmd}': ${err.message}`)
  }
}

/**
 * Execute a copier command to generate a project
 * @param {string} projectRoot - Destination path for the project
 * @param {Object} [data] - Data options to pass to copier (key=value pairs)
 * @param {Object} [options] - Additional options
 * @param {boolean} [options.force] - Force overwrite existing project
 */
function executeCopier (projectRoot, data = {}, options = {}) {
  const dataArgs = Object.entries(data)
    .map(([key, value]) => `--data ${key}=${value}`)
    .join(' ')

  const forceArg = options.force ? '--force' : '--overwrite'

  const cmd = `task copier -- copy . --vcs-ref=HEAD --defaults ${dataArgs} ${forceArg} ${projectRoot}`.trim()
  executeCommand(cmd)
}

/**
 * Initialize a git repository in a directory
 * @param {string} cwd - Working directory
 * @param {Object} [options] - Options
 * @param {string} [options.branch] - Initial branch name
 * @param {string} [options.userName] - Git user name
 * @param {string} [options.userEmail] - Git user email
 */
function initGitRepo (cwd, options = {}) {
  const {
    branch = 'main',
    userName = 'CI Test User',
    userEmail = 'ci-test@example.com'
  } = options

  executeCommand(`git init --initial-branch=${branch}`, { cwd })
  executeCommand(`git config user.name "${userName}"`, { cwd })
  executeCommand(`git config user.email "${userEmail}"`, { cwd })
}

/**
 * Create an initial git commit
 * @param {string} cwd - Working directory
 * @param {Object} [options] - Options
 * @param {string} [options.message] - Commit message
 * @param {string} [options.tag] - Tag to create after commit
 */
function createInitialCommit (cwd, options = {}) {
  const { message = 'feat: init', tag } = options

  executeCommand('git add .', { cwd })
  executeCommand(`git commit -m"${message}"`, { cwd })

  if (tag) {
    executeCommand(`git tag ${tag}`, { cwd })
  }
}

module.exports = {
  executeCommand,
  executeCopier,
  initGitRepo,
  createInitialCommit
}
