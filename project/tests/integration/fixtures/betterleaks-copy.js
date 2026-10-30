const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const source = fs.existsSync('/workspace/.config/betterleaks/Taskfile.yml') ? '/workspace' : path.resolve(__dirname, '../../../..')

function command (cwd, program, args, options = {}) {
  const result = spawnSync(program, args, { cwd, encoding: 'utf8', timeout: 120000, ...options })
  assert.ifError(result.error)
  return { status: result.status, output: result.stdout + result.stderr }
}

function git (cwd, ...args) {
  const result = command(cwd, 'git', ['-c', `safe.directory=${cwd}`, ...args])
  assert.equal(result.status, 0, result.output)
}

function fixture () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'betterleaks-copy-'))
  fs.chmodSync(dir, 0o755)
  fs.mkdirSync(path.join(dir, '.config/betterleaks'), { recursive: true })
  for (const name of ['Taskfile.yml', 'config.toml']) {
    fs.copyFileSync(path.join(source, '.config/betterleaks', name), path.join(dir, '.config/betterleaks', name))
  }
  fs.writeFileSync(path.join(dir, 'Taskfile.yml'), 'version: "3"\nincludes:\n  betterleaks: .config/betterleaks/Taskfile.yml\n')
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.name', 'Copy regression')
  git(dir, 'config', 'user.email', 'copy-test@example.org')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'chore: prepare copy fixture')
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
  fs.writeFileSync(path.join(dir, 'application.txt'), 'A complete readable file.\n')
  git(dir, 'add', 'application.txt')
  git(dir, 'commit', '-qm', 'feat: add readable application file')
  fs.appendFileSync(path.join(dir, 'application.txt'), 'A readable staged change.\n')
  git(dir, 'add', 'application.txt')
  return dir
}

function scan (dir, mode) {
  const options = {
    env: { ...process.env, TASK_BETTERLEAKS_MODE: 'docker', TASK_BETTERLEAKS_REDACT: '100', TASK_BETTERLEAKS_CONTAINER_NAME: 'betterleaks-copy-test' }
  }
  if (process.getuid() === 0) {
    options.uid = 65534
    options.gid = fs.statSync('/var/run/docker.sock').gid
    const grant = entry => {
      fs.chownSync(entry, options.uid, options.gid)
      if (fs.statSync(entry).isDirectory()) for (const child of fs.readdirSync(entry)) grant(path.join(entry, child))
    }
    grant(dir)
  }
  return command(dir, 'task', ['-x', `betterleaks:${mode}`], options)
}

module.exports = { fixture, git, scan }
