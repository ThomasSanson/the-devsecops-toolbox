/**
 * Minimal JUnit reporter (CodeceptJS plugin).
 *
 * CodeceptJS 4 does ship a `junitReporter` plugin, but switching to it changes
 * the XML this suite emits, and two gates read that XML (`red-is-real` and
 * GitLab's "Test summary" widget). Kept as-is deliberately; swapping it is its
 * own change, with its own proof.
 *
 * Why hand-rolled instead of mocha-junit-reporter: CodeceptJS 3.7's
 * run-workers path only wires mocha-junit-reporter if you ALSO pull in
 * mochawesome — lib/workers.js reads `reporterOptions.mochawesome.options`
 * unconditionally, so the official recipe forces three npm deps, a rebuild of
 * the baked test image and a 374 KB lockfile churn. This ~40-line event
 * listener produces the same GitLab `artifacts:reports:junit` XML with none of
 * that: it lives under project/tests (copied fresh into the container on every
 * run, so no rebuild) and reaches the codeceptjs event bus through the same
 * relative path codecept.conf.js already uses for its step files.
 *
 * One XML file per worker thread (results-<threadId>.xml) so parallel workers
 * never clobber each other — run-workers uses worker_threads, which share the
 * process pid, so threadId (not pid) is the unique discriminant. GitLab merges
 * the files via the `*.xml` glob.
 */
// cspell:ignore mochawesome
const fs = require('fs')
const path = require('path')
const { threadId } = require('worker_threads')
const { event, output } = require('../../../../.config/codeceptjs/node_modules/codeceptjs')

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

module.exports = function junitReporter () {
  const cases = []

  const record = (test, status) =>
    cases.push({
      name: typeof test.fullTitle === 'function' ? test.fullTitle() : test.title,
      time: (test.duration || 0) / 1000,
      status,
      err: test.err && (test.err.message || String(test.err))
    })

  event.dispatcher.on(event.test.passed, (t) => record(t, 'passed'))
  event.dispatcher.on(event.test.failed, (t) => record(t, 'failed'))
  event.dispatcher.on(event.test.skipped, (t) => record(t, 'skipped'))

  event.dispatcher.on(event.all.after, () => {
    if (!cases.length) return
    const dir = path.join(global.codecept_dir || process.cwd(), '_output', 'junit')
    fs.mkdirSync(dir, { recursive: true })

    const failures = cases.filter((c) => c.status === 'failed').length
    const skipped = cases.filter((c) => c.status === 'skipped').length
    const body = cases
      .map((c) => {
        const open = `    <testcase name="${esc(c.name)}" classname="e2e" time="${c.time.toFixed(3)}">`
        if (c.status === 'failed') return `${open}\n      <failure message="${esc(c.err)}"/>\n    </testcase>`
        if (c.status === 'skipped') return `${open}<skipped/></testcase>`
        return `${open}</testcase>`
      })
      .join('\n')

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      `<testsuites tests="${cases.length}" failures="${failures}">\n` +
      `  <testsuite name="e2e" tests="${cases.length}" failures="${failures}" skipped="${skipped}">\n` +
      `${body}\n` +
      '  </testsuite>\n' +
      '</testsuites>\n'

    const file = path.join(dir, `results-${threadId}.xml`)
    fs.writeFileSync(file, xml)
    output.print(`📄 JUnit report: ${file} (${cases.length} tests, ${failures} failures)`)
  })
}
