/**
 * Two tasks wrote git's safe.directory into the developer's global git
 * config with `git config --global --add`, which appends a line every time:
 * dev:setup-git-security on every init, and the branch variable of
 * glab:release:lock-default-branch every time that task runs (issue #158).
 * Run often enough, ~/.gitconfig fills with copies of the same line, and two
 * runs side by side race on its lock file.
 *
 * This test runs both real tasks twice, from a throwaway Taskfile that
 * includes the toolbox's own, with a throwaway HOME and a throwaway git
 * repository. The lock task is told the release is off, so it stops at its
 * "Skip" line without asking GitLab anything. Run in the suite's container,
 * where /workspace holds the repository:
 *
 *   node --test project/tests/unit/safe-directory.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const REPO = fs.existsSync('/workspace/.config/dev/Taskfile.yml') ? '/workspace' : path.resolve(__dirname, '../../..')

function sandbox () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-directory-'))
  const home = path.join(dir, 'home')
  const project = path.join(dir, 'project')
  fs.mkdirSync(home)
  fs.mkdirSync(project)
  execFileSync('git', ['init', '--quiet', project])
  fs.writeFileSync(path.join(dir, 'Taskfile.yml'), [
    "version: '3'",
    'includes:',
    `  dev: { taskfile: ${REPO}/.config/dev/Taskfile.yml, dir: ${project} }`,
    `  glab: { taskfile: ${REPO}/.config/glab/Taskfile.yml, dir: ${project} }`,
    'tasks:',
    '  git-security:',
    '    cmds: [{ task: dev:setup-git-security }]',
    ''
  ].join('\n'))
  const env = { ...process.env, HOME: home, TASK_DEVSECOPS_RELEASE_ALLOW_PUSH: 'false' }
  delete env.GIT_CONFIG_GLOBAL
  const run = (...args) => {
    const result = spawnSync('task', ['-d', dir, ...args], { cwd: dir, env, encoding: 'utf8' })
    assert.equal(result.status, 0, `task ${args.join(' ')} failed:\n${result.stdout}${result.stderr}`)
  }
  // Read from the throwaway folder: git reads the global file from anywhere,
  // and a repository it cannot open must not turn the answer into nothing.
  const entries = () => {
    const result = spawnSync('git', ['config', '--global', '--get-all', 'safe.directory'], { cwd: dir, env, encoding: 'utf8' })
    return result.stdout.split('\n').filter(Boolean)
  }
  return { dir, project, run, entries }
}

test('@safe-directory-once init writes the project to safe.directory once, as an absolute path', () => {
  const box = sandbox()
  try {
    box.run('git-security')
    box.run('git-security')
    assert.deepEqual(box.entries(), [fs.realpathSync(box.project)], 'Two inits must leave one line, naming the project folder')
  } finally {
    fs.rmSync(box.dir, { recursive: true, force: true })
  }
})

test('@safe-directory-once the release lock task leaves the global git config alone', () => {
  const box = sandbox()
  try {
    box.run('glab:release:lock-default-branch')
    box.run('glab:release:lock-default-branch')
    assert.deepEqual(box.entries(), [], 'The lock task must not write safe.directory into ~/.gitconfig')
  } finally {
    fs.rmSync(box.dir, { recursive: true, force: true })
  }
})
