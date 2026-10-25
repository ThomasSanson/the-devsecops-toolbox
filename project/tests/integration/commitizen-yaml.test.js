const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const recordEvidence = require('./fixtures/storyboard-evidence')
const { initializeGit } = require('./fixtures/workspace')

const source = fs.existsSync('/workspace/.config/commitizen/Taskfile.yml') ? '/workspace' : path.resolve(__dirname, '../../..')

function command (cwd, executable, args) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', timeout: 120000 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result.stdout
}

function fixture () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commitizen-yaml-'))
  fs.mkdirSync(path.join(dir, '.config/python'), { recursive: true })
  fs.cpSync(path.join(source, '.config/commitizen'), path.join(dir, '.config/commitizen'), { recursive: true })
  fs.copyFileSync(path.join(source, '.config/python/.python-version'), path.join(dir, '.config/python/.python-version'))
  const current = fs.readFileSync(path.join(source, 'VERSION'), 'utf8').trim()
  const template = fs.readFileSync(path.join(source, '.config/commitizen/cz.yaml.jinja'), 'utf8')
  fs.writeFileSync(path.join(dir, '.config/commitizen/cz.yaml'), template.replace('version: 0.1.0', `version: ${current}`))
  fs.writeFileSync(path.join(dir, 'VERSION'), `${current}\n`)
  fs.writeFileSync(path.join(dir, 'Taskfile.yml'), 'version: "3"\nincludes:\n  commitizen: .config/commitizen/Taskfile.yml\n')
  initializeGit(dir, current)
  return { dir, current }
}

test('@commitizen-yaml-format version generation preserves valid list indentation without committing', () => {
  const { dir, current } = fixture()
  const config = path.join(dir, '.config/commitizen/cz.yaml')
  const python = fs.readFileSync(path.join(source, '.config/python/.python-version'), 'utf8').trim()
  const requirement = fs.readFileSync(path.join(source, '.config/commitizen/requirements.txt'), 'utf8').trim()
  const args = ['--python', python, '--from', requirement, 'cz', '--config', config, 'bump', '--yes', '--increment', 'PATCH', '--check-consistency']
  try {
    const head = command(dir, 'git', ['rev-parse', 'HEAD'])
    const tags = command(dir, 'git', ['tag', '--list'])
    const before = fs.readFileSync(config, 'utf8')
    recordEvidence('commitizen-input.yaml', before)
    command(dir, 'uvx', [...args, '--dry-run'])
    assert.equal(fs.readFileSync(config, 'utf8'), before, 'A simulated bump must not rewrite the configuration')
    command(dir, 'uvx', [...args, '--version-files-only'])
    const after = fs.readFileSync(config, 'utf8')
    const next = current.replace(/(\d+)$/, number => String(Number(number) + 1))
    assert.equal(fs.readFileSync(path.join(dir, 'VERSION'), 'utf8'), `${next}\n`, 'The real version file must be updated')
    assert.ok(after.includes(`  version: ${next}\n`), 'The real configuration version must be updated')
    assert.equal(command(dir, 'git', ['rev-parse', 'HEAD']), head, 'The probe must create no commit')
    assert.equal(command(dir, 'git', ['tag', '--list']), tags, 'The probe must create no tag')
    assert.match(after, /^ {2}version_files:\n {4}- VERSION$/m, 'Generated sequence items must retain the indentation required by the existing linters')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
