const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function initializeGit (dir, tag) {
  const commands = [['init', '-q', '--initial-branch=main'], ['add', '.'], ['commit', '-qm', 'chore: prepare native fixture']]
  if (tag) commands.push(['tag', tag])
  for (const args of commands) {
    const result = spawnSync('git', ['-c', 'user.name=Native regression', '-c', 'user.email=native@example.org', ...args], { cwd: dir, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
}

function copyTemplate (source, destination) {
  if (fs.existsSync(path.join(source, '.git'))) {
    const listing = spawnSync('git', ['-c', `safe.directory=${source}`, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: source, encoding: 'utf8' })
    assert.equal(listing.status, 0, listing.stderr)
    for (const file of new Set(listing.stdout.split('\0').filter(Boolean))) {
      const target = path.join(destination, file)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.cpSync(path.join(source, file), target, { recursive: true, verbatimSymlinks: true })
    }
  } else {
    const transient = new Set(['.git', 'tmp', 'node_modules', '_output', 'megalinter-reports'])
    fs.cpSync(source, destination, { recursive: true, verbatimSymlinks: true, filter: file => !transient.has(path.basename(file)) })
  }
}

module.exports = { initializeGit, copyTemplate }
