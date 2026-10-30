const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { PassThrough } = require('node:stream')
const { gzipSync } = require('node:zlib')

const engine = fs.existsSync('/app/.config/codeceptjs/package.json')
  ? '/app/.config/codeceptjs/package.json'
  : path.resolve(__dirname, '../../../../.config/codeceptjs/package.json')
const bodyParser = createRequire(engine)('body-parser')
const accepted = { message: 'accepted compressed JSON' }
const frame = gzipSync(JSON.stringify(accepted))
const trailing = Buffer.alloc(1024, 0x58)
const request = new PassThrough()
request.headers = {
  'content-type': 'application/json',
  'content-encoding': 'gzip',
  'content-length': String(frame.length + 1 + trailing.length)
}

// A real decoder finishes before the request: late bytes must not crash it.
bodyParser.json()(request, {}, error => {
  assert.ifError(error)
  assert.deepEqual(request.body, accepted)
  console.log('Accepted compressed JSON is preserved')
  request.once('end', () => {
    assert.deepEqual(request.body, accepted)
    console.log('Trailing bytes are consumed without a process crash')
  })
  setImmediate(() => request.end(trailing))
})
request.write(Buffer.concat([frame, Buffer.from([0])]))
