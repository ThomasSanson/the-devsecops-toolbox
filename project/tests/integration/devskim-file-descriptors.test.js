const test = require('node:test')
const assert = require('node:assert/strict')
const { scanner } = require('./fixtures/devskim-file-descriptors')

test('@devskim-file-descriptors scans every readable input above the inherited soft limit', () => {
  const count = 2200
  const fixture = scanner(count)
  try {
    const result = fixture.run('analyze', '--file-format', 'sarif', '-E', '--source-code', 'source files', '--skip-excerpts')
    assert.equal(result.status, count % 256, 'Every input must be scanned and the native issue-count status must be preserved')
    const report = JSON.parse(result.stdout)
    const findings = report.runs.flatMap(run => run.results)
    assert.equal(findings.length, count, 'No finding may be lost when the soft descriptor limit is reached')
    assert.equal(new Set(findings.map(item => item.locations[0].physicalLocation.artifactLocation.uri)).size, count)
    assert.ok(findings.every(item => item.ruleId === 'DS117838' && item.level === 'error'))
    assert.ok(findings.every(item => !item.locations[0].physicalLocation.region.snippet?.text), 'The scanner must receive --skip-excerpts unchanged')
    const invalid = fixture.run('analyze', '--source-code', 'missing source')
    assert.notEqual(invalid.status, 0, 'An invalid scan must still fail')
  } finally {
    fixture.close()
  }
})
