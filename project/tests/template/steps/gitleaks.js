/**
 * Gitleaks Domain Steps
 *
 * Steps for validating selective copy behavior used by gitleaks scan-branch.
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const PRIVATE_KEY_HEADER_PARTS = ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----']
const PRIVATE_KEY_FOOTER_PARTS = ['-----END', 'RSA', 'PRIVATE', 'KEY-----']

const TEST_PRIVATE_KEY_SECRET = [
  PRIVATE_KEY_HEADER_PARTS.join(' '),
  'MIIEpAIBAAKCAQEA0testsecretfortemplategitleakstestingonly0000000000',
  PRIVATE_KEY_FOOTER_PARTS.join(' '),
  ''
].join('\n')

function runCommand (cmd, cwd) {
  return execSync(cmd, { cwd, encoding: 'utf8' })
}

function register () {
  When('I create selective-copy fixtures in the generated project', function () { // eslint-disable-line no-undef
    const root = this.projectRoot

    fs.writeFileSync(path.join(root, 'tracked.txt'), 'tracked file\n')
    runCommand('git add tracked.txt', root)
    runCommand('git commit -m "test: add tracked fixture"', root)

    fs.writeFileSync(path.join(root, 'untracked.txt'), 'untracked file\n')

    fs.appendFileSync(path.join(root, '.gitignore'), '\nignored.secret\nignored-dir/\n')
    fs.writeFileSync(path.join(root, 'ignored.secret'), 'ignored secret\n')
    fs.mkdirSync(path.join(root, 'ignored-dir'), { recursive: true })
    fs.writeFileSync(path.join(root, 'ignored-dir', 'inside.txt'), 'ignored nested file\n')
  })

  When('I commit a tracked file containing a fake private key secret', function () { // eslint-disable-line no-undef
    const root = this.projectRoot
    fs.writeFileSync(path.join(root, 'tracked-secret.pem'), TEST_PRIVATE_KEY_SECRET)
    runCommand('git add tracked-secret.pem', root)
    runCommand('git commit -m "test: add tracked secret fixture"', root)
  })

  When('I create an ignored file containing a fake private key secret', function () { // eslint-disable-line no-undef
    const root = this.projectRoot
    fs.appendFileSync(path.join(root, '.gitignore'), '\nignored-secret.pem\n')
    fs.writeFileSync(path.join(root, 'ignored-secret.pem'), TEST_PRIVATE_KEY_SECRET)
  })

  When('I commit a safe change for branch scanning', function () { // eslint-disable-line no-undef
    const root = this.projectRoot
    fs.writeFileSync(path.join(root, 'safe-change.txt'), 'safe content\n')
    runCommand('git add .gitignore safe-change.txt', root)
    runCommand('git commit -m "test: add safe change"', root)
  })

  When('I build the selective-copy archive in the generated project', function () { // eslint-disable-line no-undef
    const root = this.projectRoot
    const archivePath = path.join(root, 'tmp', 'selective-copy.tar')

    fs.mkdirSync(path.dirname(archivePath), { recursive: true })

    runCommand(
      "(printf '.git\\0'; git ls-files -z --cached --others --exclude-standard) | tar --null -T - -cf tmp/selective-copy.tar",
      root
    )

    this.selectiveCopyArchiveEntries = runCommand('tar -tf tmp/selective-copy.tar', root)
      .split('\n')
      .filter(Boolean)
  })

  Then('the selective-copy archive should contain {string}', function (expectedEntry) { // eslint-disable-line no-undef
    const entries = this.selectiveCopyArchiveEntries || []
    const found = entries.some(entry => entry === expectedEntry || entry.includes(expectedEntry))

    if (!found) {
      throw new Error(`Expected selective-copy archive to contain "${expectedEntry}", but got: ${entries.join(', ')}`)
    }
  })

  Then('the selective-copy archive should not contain {string}', function (unexpectedEntry) { // eslint-disable-line no-undef
    const entries = this.selectiveCopyArchiveEntries || []
    const found = entries.some(entry => entry === unexpectedEntry || entry.includes(unexpectedEntry))

    if (found) {
      throw new Error(`Expected selective-copy archive to NOT contain "${unexpectedEntry}", but got: ${entries.join(', ')}`)
    }
  })
}

register()

module.exports = { register }
