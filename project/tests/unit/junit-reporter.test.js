/**
 * The e2e suite's JUnit reporter (../e2e/support/junit-reporter.js) gives
 * GitLab the time of every scenario. CodeceptJS sends test.passed or
 * test.failed from inside the scenario, and mocha only sets test.duration
 * after that, when the scenario calls back. A reporter that reads
 * test.duration when the verdict arrives writes 0 for every scenario.
 *
 * This test drives the reporter through CodeceptJS's own event bus, in that
 * order, without a browser or GitLab. The engine is installed in the suite's
 * image (task project:build:tests), so the test runs there:
 *
 *   docker run --rm -v "$PWD/project/tests:/app/project/tests" \
 *     the-devsecops-toolbox-codeceptjs node --test 'project/tests/unit/*.test.js'
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { setTimeout: sleep } = require('timers/promises')
const { event } = require('../../../.config/codeceptjs/node_modules/codeceptjs')
const junitReporter = require('../e2e/support/junit-reporter')

// Keeps a scenario busy for at least `ms` on the clock: a timer alone may
// fire a millisecond early.
async function busy (ms) {
  const end = performance.now() + ms
  while (performance.now() < end) await sleep(end - performance.now())
}

// One scenario as CodeceptJS runs it under mocha: the verdict is sent from
// inside the scenario, and mocha sets test.duration only once it is over.
async function scenario (title, ms, err) {
  const mochaTest = { title, fullTitle: () => title }
  event.dispatcher.emit(event.test.before, mochaTest)
  const start = Date.now()
  event.dispatcher.emit(event.test.started, mochaTest)
  await busy(ms)
  if (err) mochaTest.err = err
  event.dispatcher.emit(err ? event.test.failed : event.test.passed, mochaTest, err)
  event.dispatcher.emit(event.test.finished, mochaTest)
  mochaTest.duration = Date.now() - start
  event.dispatcher.emit(event.test.after, mochaTest)
}

test('@junit-real-durations each test case carries the time its scenario really ran', async (t) => {
  global.codecept_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'junit-durations-'))
  t.after(() => fs.rmSync(global.codecept_dir, { recursive: true, force: true }))
  junitReporter()

  await scenario('a passing scenario', 1200)
  await scenario('a failing scenario', 300, new Error('expected 1, got 2'))
  // mocha skips this one without running it: it never starts.
  event.dispatcher.emit(event.test.skipped, { title: 'a skipped scenario', fullTitle: () => 'a skipped scenario' })
  event.dispatcher.emit(event.all.after)

  const dir = path.join(global.codecept_dir, '_output', 'junit')
  const xml = fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8')
  const time = {}
  for (const [testcase] of xml.matchAll(/<testcase\b[^>]*>/g)) {
    time[testcase.match(/ name="([^"]*)"/)[1]] = testcase.match(/ time="([^"]*)"/)[1]
  }
  const passed = time['a passing scenario']
  const failed = time['a failing scenario']
  const skipped = time['a skipped scenario']
  assert.ok(Number(passed) >= 1.2, `A scenario that passed after 1.2 s reports ${passed} s`)
  assert.ok(Number(failed) >= 0.3 && Number(failed) < 1.2, `A scenario that failed after 0.3 s, right after a 1.2 s one, reports ${failed} s`)
  assert.ok(Number(skipped) === 0, `A scenario that never started reports ${skipped} s`)
})
