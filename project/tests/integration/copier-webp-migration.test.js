/**
 * Updating a generated project to 26.0.0 converts its reviewed PNG
 * baselines to lossless WebP (issue #363). The visual helper 3 compares
 * WebP references: a PNG one left in place is recorded anew on the next run,
 * and that test passes without comparing anything.
 *
 * The conversion itself belongs to the storyboard package and is tested
 * there. Here a stand-in `npx` records what the migration asks for.
 *
 *   node --test project/tests/integration/copier-webp-migration.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..', '..', '..')
const SCRIPT = path.join(ROOT, '.config', 'copier', 'convert-baselines-webp.sh')
const BASE = 'project/tests/e2e/screenshots/base'

function project ({ pngs = [], npx = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webp-migration-'))
  fs.mkdirSync(path.join(dir, '.config/codeceptjs'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.config/codeceptjs/package.json'),
    JSON.stringify({ devDependencies: { '@digital-commons-official/codeceptjs-storyboard': '3.1.0' } }, null, 2))
  for (const png of pngs) {
    fs.mkdirSync(path.dirname(path.join(dir, png)), { recursive: true })
    fs.writeFileSync(path.join(dir, png), 'png')
  }
  const bin = path.join(dir, '.bin')
  fs.mkdirSync(bin)
  for (const tool of ['find', 'sed', 'dirname', 'sort', 'cat']) {
    const real = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim()
    fs.symlinkSync(real, path.join(bin, tool))
  }
  if (npx) {
    fs.writeFileSync(path.join(bin, 'npx'), `#!/bin/sh\necho "$*" >> "${dir}/npx.calls"\n`, { mode: 0o755 })
  }
  const run = spawnSync('/bin/sh', [SCRIPT], { cwd: dir, env: { PATH: bin }, encoding: 'utf8' })
  const calls = fs.existsSync(path.join(dir, 'npx.calls')) ? fs.readFileSync(path.join(dir, 'npx.calls'), 'utf8') : ''
  return { run, calls }
}

test('@webp-migration-converts converts each baseline folder that still holds PNG files', () => {
  const { run, calls } = project({ pngs: [`${BASE}/act/story/frame.png`, 'project/tests/visual/screenshots/base/page.png'] })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  assert.equal(calls,
    '-y -p @digital-commons-official/codeceptjs-storyboard@3.1.0 codeceptjs-storyboard-webp project/tests/e2e/screenshots/base\n' +
    '-y -p @digital-commons-official/codeceptjs-storyboard@3.1.0 codeceptjs-storyboard-webp project/tests/visual/screenshots/base\n')
})

test('@webp-migration-no-png leaves a project without PNG baselines alone', () => {
  const { run, calls } = project()
  assert.equal(run.status, 0, run.stdout + run.stderr)
  assert.equal(calls, '')
})

test('@webp-migration-no-node prints the command when Node.js is missing', () => {
  const { run, calls } = project({ pngs: [`${BASE}/act/story/frame.png`], npx: false })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  assert.equal(calls, '')
  assert.match(run.stdout, /npx -y -p @digital-commons-official\/codeceptjs-storyboard@3\.1\.0 codeceptjs-storyboard-webp project\/tests\/e2e\/screenshots\/base/)
})

test('@webp-migration-once runs once, when a project updates to 26.0.0', () => {
  const copier = fs.readFileSync(path.join(ROOT, 'copier.yml'), 'utf8')
  assert.match(copier, /- version: "26\.0\.0"\n {4}after:\n(?: {6}#.*\n)* {6}- "sh '\{\{ _copier_conf\.src_path \}\}\/\.config\/copier\/convert-baselines-webp\.sh'"/)
})
