const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

// GHSA-27r3-jxmh-p828: preserve the uncaught decoder error in a child process.
test('@body-parser-trailing-unit compressed JSON survives late trailing bytes', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'fixtures/body-parser-trailing.js')], {
    encoding: 'utf8',
    timeout: 5000
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, `The parser must not crash its process:\n${result.stderr}`)
  assert.match(result.stdout, /Accepted compressed JSON is preserved/)
  assert.match(result.stdout, /Trailing bytes are consumed without a process crash/)
})
