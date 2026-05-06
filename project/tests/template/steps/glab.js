/**
 * Glab Domain Steps
 *
 * Steps for testing glab (GitLab CLI) tool integration.
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { resolvePath } = require('../step_objects/content')
const { assertFileContains, assertFileExists } = require('../step_objects/assertions')

function register () {
  // When
  When('the EXPIRES_AT block from {string} is evaluated', function (scriptName) { // eslint-disable-line no-undef
    const scriptPath = path.join(this.projectRoot, '.config/glab', scriptName)
    assertFileExists(scriptPath)
    const scriptContent = fs.readFileSync(scriptPath, 'utf8')
    const blockMatch = scriptContent.match(/^if EXPIRES_AT=[\s\S]*?^fi$/m)
    if (!blockMatch) {
      throw new Error(`Could not locate the "if EXPIRES_AT=...; fi" block in ${scriptPath}`)
    }
    const probe = `${blockMatch[0]}\nprintf '%s' "$EXPIRES_AT"\n`
    this.tokenExpiresAt = execSync('bash', {
      input: probe,
      encoding: 'utf8',
      timeout: 5000
    }).trim()
  })

  // Then
  Then('the resulting expiry date is strictly before today plus 365 days', function () { // eslint-disable-line no-undef
    if (!this.tokenExpiresAt) {
      throw new Error('No EXPIRES_AT captured — the When step must run first')
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(this.tokenExpiresAt)) {
      throw new Error(`EXPIRES_AT is not an ISO date: "${this.tokenExpiresAt}"`)
    }

    const expires = new Date(`${this.tokenExpiresAt}T00:00:00Z`)
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const gitlabLimit = new Date(today)
    gitlabLimit.setUTCDate(gitlabLimit.getUTCDate() + 365)

    if (expires.getTime() >= gitlabLimit.getTime()) {
      const limitIso = gitlabLimit.toISOString().slice(0, 10)
      throw new Error(
        `Token expiry ${this.tokenExpiresAt} is not strictly before GitLab's max allowed lifetime ` +
        `(today + 365 days = ${limitIso}). GitLab.com rejects such tokens with HTTP 400.`
      )
    }
  })

  Then('the root Taskfile should include the glab taskfile reference', function () { // eslint-disable-line no-undef
    const taskfilePath = resolvePath(this, 'Taskfile.yml')
    assertFileContains(taskfilePath, 'glab:\n    taskfile: .config/glab/Taskfile.yml')
  })
}

// Auto-register when loaded by CodeceptJS
register()

module.exports = { register }
