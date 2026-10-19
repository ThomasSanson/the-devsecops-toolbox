/**
 * .config/glab/install.sh downloads glab from gitlab.com. On shared runners
 * gitlab.com sometimes answers 429, "too many requests, try again later",
 * and an installer that gives up on the first answer fails the whole job
 * (issue #337).
 *
 * This test serves a stand-in glab archive behind two 429 answers and runs
 * the real installer against it. The installer only sees a few tools on its
 * PATH (no glab, apt-get or brew), so no fallback reaches the network, and it
 * installs into a throwaway HOME, as a user who cannot write /usr/local/bin.
 * Run in the suite's container, where /workspace holds the repository:
 *
 *   node --test project/tests/unit/glab-install.test.js
 */
// cspell:ignore setpriv reuid regid
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { execFileSync, spawn } = require('child_process')

const REPO = fs.existsSync('/workspace/.config/glab/install.sh') ? '/workspace' : path.resolve(__dirname, '../../..')
const TOOLS = ['sh', 'curl', 'tar', 'gzip', 'mktemp', 'mkdir', 'mv', 'chmod', 'rm', 'uname', 'cat', 'dirname']

// A glab that only knows its version, packed the way the release packs it.
function standInArchive (dir) {
  fs.mkdirSync(path.join(dir, 'pack/bin'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'pack/bin/glab'), '#!/bin/sh\necho "glab version 0.0.0-stand-in"\n', { mode: 0o755 })
  execFileSync('tar', ['-czf', path.join(dir, 'glab.tar.gz'), '-C', path.join(dir, 'pack'), 'bin'])
  return fs.readFileSync(path.join(dir, 'glab.tar.gz'))
}

// The tools the installer may call, and nothing else.
function narrowPath (dir) {
  const bin = path.join(dir, 'tools')
  fs.mkdirSync(bin)
  for (const tool of TOOLS) fs.symlinkSync(execFileSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim(), path.join(bin, tool))
  return bin
}

function run (cmd, args, env) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', chunk => { out += chunk })
    child.stderr.on('data', chunk => { out += chunk })
    child.on('error', error => resolve({ code: -1, out: `${out}${error.message}` }))
    child.on('close', code => resolve({ code, out }))
  })
}

test('@glab-install-retry the installer waits out two 429 answers from gitlab.com and installs glab', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glab-install-'))
  fs.chmodSync(dir, 0o777)
  const archive = standInArchive(dir)
  const answers = []
  const server = http.createServer((request, response) => {
    if (answers.length < 2) {
      answers.push(429)
      response.writeHead(429, { 'Retry-After': '1' })
      return response.end('Too Many Requests')
    }
    answers.push(200)
    response.writeHead(200, { 'Content-Type': 'application/gzip' })
    response.end(archive)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)) // DevSkim: ignore DS162092 -- The test's own stand-in server on loopback.
  try {
    const home = path.join(dir, 'home')
    fs.mkdirSync(home)
    // The umask would take write access away from nobody.
    fs.chmodSync(home, 0o777)
    const env = {
      HOME: home,
      PATH: narrowPath(dir),
      GLAB_VERSION: '0.0.0',
      GLAB_DOWNLOAD_URL: `http://127.0.0.1:${server.address().port}/glab.tar.gz` // DevSkim: ignore DS162092,DS137138 -- The test's own stand-in server on loopback.
    }
    const installer = path.join(REPO, '.config/glab/install.sh')
    // As root, the installer would write /usr/local/bin: run it as nobody.
    // setpriv is found on the suite's PATH, not on the installer's narrow one.
    const { code, out } = process.getuid() === 0
      ? await run(execFileSync('sh', ['-c', 'command -v setpriv'], { encoding: 'utf8' }).trim(), ['--reuid=65534', '--regid=65534', '--clear-groups', 'sh', installer], env)
      : await run('sh', [installer], env)

    assert.deepEqual(answers, [429, 429, 200], `The installer must ask again after each 429:\n${out}`)
    assert.equal(code, 0, `The installer must succeed once gitlab.com answers:\n${out}`)
    assert.match(out, /glab version 0\.0\.0-stand-in/, out)
    assert.ok(fs.existsSync(path.join(home, '.local/bin/glab')), `glab must land in ~/.local/bin:\n${out}`)
  } finally {
    server.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
