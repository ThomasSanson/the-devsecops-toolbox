const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const source = fs.existsSync('/workspace/.config/megalinter/package.json') ? '/workspace' : path.resolve(__dirname, '../../../..')
const version = JSON.parse(fs.readFileSync(path.join(source, '.config/megalinter/package.json'))).dependencies['mega-linter-runner']

function docker (...args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 })
  assert.ifError(result.error)
  return result
}

function prepare (count) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devskim-descriptors-'))
  fs.mkdirSync(path.join(dir, '.config/megalinter'), { recursive: true })
  fs.cpSync(path.join(source, '.config/devskim'), path.join(dir, '.config/devskim'), { recursive: true })
  fs.copyFileSync(path.join(source, '.config/megalinter/config.base.yml'), path.join(dir, '.config/megalinter/config.base.yml'))
  fs.mkdirSync(path.join(dir, 'source files'))
  for (let index = 0; index < count; index++) {
    const key = crypto.randomBytes(32).toString('hex')
    fs.writeFileSync(path.join(dir, 'source files', `input-${index}.js`), `const key = "${key}";\n`)
  }
  return dir
}

function scanner (count) {
  const dir = prepare(count)
  const name = `devskim-descriptors-${crypto.randomUUID()}`
  const created = docker('create', '--name', name, '--network', 'none', '--ulimit', 'core=0:0', '--ulimit', 'nofile=128:4096', '--entrypoint', 'sleep', `ghcr.io/oxsecurity/megalinter:v${version}`, 'infinity')
  assert.equal(created.status, 0, created.stderr)
  assert.equal(docker('start', name).status, 0)
  assert.equal(docker('cp', `${dir}/.`, `${name}:/tmp/lint`).status, 0)
  return {
    run: (...args) => docker('exec', '-w', '/tmp/lint', name, 'python3', '-c', 'import os, sys, yaml; config = yaml.safe_load(open(".config/megalinter/config.base.yml")); executable = config.get("REPOSITORY_DEVSKIM_CLI_EXECUTABLE", "devskim"); os.execvp(executable, [executable, *sys.argv[1:]])', ...args),
    close: () => {
      docker('rm', '-f', name)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}

module.exports = { scanner }
