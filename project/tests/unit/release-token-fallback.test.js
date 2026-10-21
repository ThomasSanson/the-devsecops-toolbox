/**
 * The release tasks promise to fall back to TASK_COMMITIZEN_TOKEN when
 * TASK_DEVSECOPS_RELEASE_PUSH_TOKEN is not set, and their error message says
 * so. The fallback was a Task variable, while the scripts read the shell
 * environment, which Task does not fill from its variables: on a developer's
 * machine, with only TASK_COMMITIZEN_TOKEN set, the release stopped on a
 * missing token (issue #198). In CI, a variable mapping hid it.
 *
 * This test runs the real glab:release:lock-default-branch with only
 * TASK_COMMITIZEN_TOKEN set, against a stand-in GitLab API on loopback that
 * records each request. The task must reach it, with that token. Run in the
 * suite's container, where /workspace holds the repository:
 *
 *   node --test project/tests/unit/release-token-fallback.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { execFileSync, spawn } = require('child_process')

const REPO = fs.existsSync('/workspace/.config/glab/Taskfile.yml') ? '/workspace' : path.resolve(__dirname, '../../..')
const TOKEN = 'commitizen-token-for-the-test'

function run (args, options) {
  return new Promise(resolve => {
    const child = spawn('task', args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', chunk => { out += chunk })
    child.stderr.on('data', chunk => { out += chunk })
    child.on('close', code => resolve({ code, out }))
  })
}

test('@release-token-fallback the lock task reaches GitLab with TASK_COMMITIZEN_TOKEN alone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-token-'))
  const project = path.join(dir, 'project')
  fs.mkdirSync(project)
  execFileSync('git', ['init', '--quiet', project])
  fs.writeFileSync(path.join(dir, 'Taskfile.yml'), [
    "version: '3'",
    'includes:',
    `  glab: { taskfile: ${REPO}/.config/glab/Taskfile.yml, dir: ${project} }`,
    ''
  ].join('\n'))
  const seen = []
  const server = http.createServer((request, response) => {
    seen.push({ method: request.method, token: request.headers['private-token'] })
    request.resume()
    response.writeHead(request.method === 'POST' ? 201 : 204, { 'Content-Type': 'application/json' })
    response.end(request.method === 'POST' ? '{}' : '')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)) // DevSkim: ignore DS162092 -- The test's own stand-in API on loopback.
  try {
    const env = { ...process.env, HOME: dir, TASK_COMMITIZEN_TOKEN: TOKEN }
    delete env.TASK_DEVSECOPS_RELEASE_PUSH_TOKEN
    Object.assign(env, {
      TASK_DEVSECOPS_RELEASE_ALLOW_PUSH: 'true',
      TASK_DEVSECOPS_RELEASE_CURRENT_BRANCH: 'main',
      TASK_DEVSECOPS_RELEASE_DEFAULT_BRANCH: 'main',
      TASK_DEVSECOPS_RELEASE_PROJECT_PATH: 'group/project',
      TASK_DEVSECOPS_RELEASE_GITLAB_API_URL: `http://127.0.0.1:${server.address().port}` // DevSkim: ignore DS162092,DS137138 -- The test's own stand-in API on loopback.
    })
    const { code, out } = await run(['-d', dir, 'glab:release:lock-default-branch'], { cwd: dir, env })

    assert.doesNotMatch(out, /Missing required variable/, `The task must find the fallback token:\n${out}`)
    assert.equal(code, 0, `The lock task must succeed against the stand-in API:\n${out}`)
    assert.ok(seen.length > 0, `The task must call the API:\n${out}`)
    assert.ok(seen.every(r => r.token === TOKEN), `Every request must carry TASK_COMMITIZEN_TOKEN: ${JSON.stringify(seen)}`)
    assert.ok(!out.includes(TOKEN), 'The token must not be printed')
  } finally {
    server.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
