// cspell:ignore WEBPVP
/**
 * The storyboard-coverage gate accepts a product change only when a captured
 * baseline comes with it. Baselines are now lossless WebP files, as the
 * visual helper 3 writes them: a WebP capture must count as the proof, or
 * every merge request that proves its change would be refused.
 *
 *   node --test project/tests/integration/storyboard-coverage-webp.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const GATE = path.join(__dirname, '..', '..', '..', '.config', 'devsecops', 'scripts', 'check-storyboard-coverage.sh')

function commit (repo, files, message) {
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
    fs.writeFileSync(path.join(repo, file), content)
  }
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  git('add', '-A')
  git('-c', 'user.name=dev', '-c', 'user.email=dev@example.org', 'commit', '-q', '-m', message)
  return git('rev-parse', 'HEAD')
}

test('@storyboard-coverage-webp accepts a WebP baseline as the proof of a product change', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard-coverage-'))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  const base = commit(repo, { '.config/tool/Taskfile.yml': 'version: "3"\n' }, 'chore: start')
  commit(repo, {
    '.config/tool/Taskfile.yml': 'version: "3"\ntasks: {}\n',
    'project/tests/e2e/screenshots/base/02-daily-work/story/frame.webp': 'RIFF....WEBPVP8L'
  }, 'feat: change the tool and capture it')
  const run = spawnSync('bash', [GATE], { cwd: repo, env: { ...process.env, BASE: base }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  assert.match(run.stdout, /frame\.webp/)
})
