const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const engine = fs.existsSync('/app/.config/codeceptjs/package.json')
  ? '/app/.config/codeceptjs/package.json'
  : path.resolve(__dirname, '../../../.config/codeceptjs/package.json')
const { z } = createRequire(engine)('zod')

// GHSA-mrhx-c7xc-m3w5: a size bound must stop the element walk itself,
// before a large input can allocate one validation issue per element.
test('@zod-size-bound-unit oversized collections stop before visiting their elements', () => {
  let visited = 0
  const member = z.string().refine(() => {
    visited++
    return true
  })
  const cases = [
    ['array', z.array(member).max(1), ['a', 'b'], ['a']],
    ['set', z.set(member).max(1), new Set(['a', 'b']), new Set(['a'])],
    ['map', z.map(z.string(), member).max(1), new Map([['a', 'a'], ['b', 'b']]), new Map([['a', 'a']])]
  ]

  for (const [name, schema, oversized, accepted] of cases) {
    visited = 0
    const rejected = schema.safeParse(oversized)
    assert.equal(rejected.success, false, `${name}: reject the oversized collection`)
    assert.equal(visited, 0, `${name}: reject before visiting any element`)
    assert.deepEqual(rejected.error.issues.map(issue => issue.code), ['too_big'])
    assert.deepEqual(schema.parse(accepted), accepted, `${name}: retain the accepted input`)
    assert.equal(visited, 1, `${name}: validate the accepted element`)
  }
})
