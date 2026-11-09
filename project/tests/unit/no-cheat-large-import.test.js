/**
 * The no-cheat gate reads every line a merge request adds. A merge request that
 * imports a whole codebase adds millions of them: on one project, 2,602 files
 * and 2 million lines ran the job past its 1 h timeout, twice, with no verdict
 * (issue #373). The gate redid, on every line, the work that depends only on
 * the file: is it a test, which rules read it, was it added whole.
 *
 * This test imports 500 files of 200 lines next to one case of every kind the
 * gate must catch or let through, and asks for the same findings in a bounded
 * time. Run in the suite's container, where /workspace holds the repository:
 *
 *   node --test project/tests/unit/no-cheat-large-import.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const REPO = fs.existsSync('/workspace/.config/devsecops/scripts/check-no-cheat.sh') ? '/workspace' : path.resolve(__dirname, '../../..')
const GATE = path.join(REPO, '.config', 'devsecops', 'scripts', 'check-no-cheat.sh')

// 100,000 added lines read in 35 s before the fix, about 2 s after it.
const FILES = 500
const LINES = 200
const BOUND_MS = 15000

function commit (repo, files, message) {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(repo, file)
    if (content === null) {
      fs.rmSync(target)
      continue
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  git('add', '-A')
  git('-c', 'user.name=dev', '-c', 'user.email=dev@example.org', 'commit', '-q', '-m', message)
  return git('rev-parse', 'HEAD')
}

test('@no-cheat-large-import reads a 100,000-line import in bounded time and finds the same switched-off checks', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'no-cheat-large-import-'))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  const base = commit(repo, {
    '.config/gitlab/ci/jobs.yml': 'build:\n  script: [true]\n',
    'project/tests/e2e/login.feature': 'Feature: login\n  Scenario: sign in\n    Then I see the home page\n',
    'project/tests/unit/math.test.js': "test('adds', () => {\n  assert.equal(1 + 1, 2)\n  assert.equal(2 + 2, 4)\n})\n",
    'project/tests/unit/old.test.js': "test('old', () => {\n  assert.ok(true)\n})\n"
  }, 'chore: start')

  const change = {
    // Caught: a job that had to pass may now fail, a skipped scenario, a
    // linter silenced in a test that was already there, a check removed, a
    // test file deleted.
    '.config/gitlab/ci/jobs.yml': 'build:\n  script: [true]\n  allow_failure: true\n',
    'project/tests/e2e/login.feature': 'Feature: login\n  @skip\n  Scenario: sign in\n    Then I see the home page\n',
    'project/tests/unit/math.test.js': "// eslint-disable-next-line no-undef\ntest('adds', () => {\n  assert.equal(1 + 1, 2)\n})\n",
    'project/tests/unit/old.test.js': null,
    // Let through: the same words in files that arrive whole.
    '.config/gitlab/ci/extra.yml': 'lint:\n  script: [true]\n  allow_failure: true\n',
    'project/tests/unit/lint.test.js': "// eslint-disable-next-line no-undef\ntest('lints', () => {})\n"
  }
  for (let i = 0; i < FILES; i++) {
    const lines = Array.from({ length: LINES }, (_, j) => `const value${j} = ${j} // imported line`)
    change[`project/app/src/module${i % 50}/file${i}.js`] = lines.join('\n') + '\n'
  }
  commit(repo, change, 'feat: import the application')

  const started = Date.now()
  const run = spawnSync('bash', [GATE], { cwd: repo, env: { ...process.env, BASE: base }, encoding: 'utf8', timeout: BOUND_MS })
  const elapsed = Date.now() - started

  assert.ok(!run.error, `the gate was still reading after ${BOUND_MS / 1000} s on ${FILES * LINES} added lines`)
  assert.equal(run.status, 1, run.stdout + run.stderr)
  // Each finding opens with "   ~ file:line", the ~ wrapped in colour codes.
  const found = [...run.stdout.matchAll(/^ {3}\S+ (\S+:\d+)$/gm)].map(match => match[1])
  assert.deepEqual(found, [
    '.config/gitlab/ci/jobs.yml:3',
    'project/tests/e2e/login.feature:2',
    'project/tests/unit/math.test.js:1',
    'project/tests/unit/math.test.js:3',
    'project/tests/unit/old.test.js:2'
  ], run.stdout)
  assert.ok(elapsed < BOUND_MS, `${elapsed} ms`)
})
