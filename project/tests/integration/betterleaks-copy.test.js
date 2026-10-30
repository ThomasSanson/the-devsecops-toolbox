const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { fixture, git, scan } = require('./fixtures/betterleaks-copy')

for (const mode of ['protect', 'scan-full', 'scan-branch']) {
  test(`@betterleaks-copy-${mode} refuses incomplete input and preserves clean and secret scans`, () => {
    const dir = fixture()
    const blocked = path.join(dir, 'unreadable.txt')
    try {
      const clean = scan(dir, mode)
      assert.equal(clean.status, 0, clean.output)
      assert.match(clean.output, /No secrets detected/)
      fs.writeFileSync(blocked, 'Synthetic unreadable input.\n', { mode: 0o000 })
      const incomplete = scan(dir, mode)
      assert.match(incomplete.output, /Permission denied/, 'The real tar must encounter an unreadable source')
      assert.notEqual(incomplete.status, 0, 'An incomplete repository copy must fail the task')
      assert.doesNotMatch(incomplete.output, /No secrets detected|scanned ~/i, 'The scanner and success message must not run after an incomplete copy')
      fs.chmodSync(blocked, 0o600)
      fs.unlinkSync(blocked)
      fs.writeFileSync(path.join(dir, 'credential.js'), `const authorization = "Bearer ${crypto.randomBytes(32).toString('hex')}"\n`)
      git(dir, 'add', 'credential.js')
      if (mode === 'scan-branch') git(dir, 'commit', '-qm', 'test: add synthetic credential')
      const secret = scan(dir, mode)
      assert.notEqual(secret.status, 0, 'A complete copy containing a synthetic credential must still fail')
      assert.match(secret.output, /bearer-token-hardcoded/)
      assert.match(secret.output, /REDACTED/)
      assert.doesNotMatch(secret.output, /No secrets detected/)
    } finally {
      if (fs.existsSync(blocked)) fs.chmodSync(blocked, 0o600)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
}
