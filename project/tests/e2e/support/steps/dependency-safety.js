/* global inject Given Then After */
const assert = require('node:assert/strict')
const { openLocalTerminal } = require('../helpers/localTerminal')
const { terminalCard } = require('../terminal/capture')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const { I } = inject()
const DURATION_MASKS = [
  [/\(\d+(\.\d+)?m?s\)/g, '(<duration>)'],
  [/duration_ms \d+(\.\d+)?/g, 'duration_ms <duration>']
]
let closeTerminal = null

After(() => {
  if (closeTerminal) closeTerminal()
  closeTerminal = null
})

storyboardStep(Given, 'the test engine has a regression for collection size limits and accepted values', async () => {
  closeTerminal = await openLocalTerminal(I, { cwd: '/workspace', env: process.env, port: 7798, width: 1440, height: 1000 })
  const screen = await terminalCard(I, 'collection-specification', 'cat project/tests/unit/zod-size-bound.test.js')
  assert.ok(screen.includes('assert.equal(visited, 0'), 'The setup must show the rejection before any element visit')
  assert.ok(screen.includes('schema.parse(accepted), accepted'), 'The setup must show that accepted inputs are preserved')
})

storyboardStep(Then, 'the installed test engine passes the collection size regression', async () => {
  const screen = await terminalCard(I, 'collection-result', 'task -x project:test:codeceptjs:dependencies; printf "exit code %s\\n" "$?"', { mask: DURATION_MASKS })
  assert.match(screen, /pass\s+1/, 'The dependency regression must pass')
  assert.match(screen, /fail\s+0/, 'No dependency assertion may fail')
  assert.ok(screen.includes('exit code 0'), 'The task must preserve the successful test exit code')
})

storyboardStep(Given, 'the test engine has a regression for late compressed request bytes', async () => {
  closeTerminal = await openLocalTerminal(I, { cwd: '/workspace', env: process.env, port: 7799, width: 1440, height: 1000 })
  const screen = await terminalCard(I, 'compressed-request-specification', 'cat project/tests/unit/fixtures/body-parser-trailing.js')
  assert.ok(screen.includes('bodyParser.json()(request'), 'The setup must invoke the real parser')
  assert.ok(screen.includes('setImmediate(() => request.end(trailing))'), 'The setup must deliver trailing bytes after parsing')
})

storyboardStep(Then, 'the installed test engine survives the late compressed request bytes', async () => {
  const screen = await terminalCard(I, 'compressed-request-result', 'task -x project:test:codeceptjs:body-parser; printf "exit code %s\\n" "$?"', { mask: DURATION_MASKS })
  assert.match(screen, /pass\s+1/, 'The compressed request regression must pass')
  assert.match(screen, /fail\s+0/, 'No parser assertion may fail')
  assert.ok(screen.includes('exit code 0'), 'The child process must survive without an uncaught decoder error')
})
