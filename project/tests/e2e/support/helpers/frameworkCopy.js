/**
 * A throwaway, writable copy of the framework — the "safe zone" every scenario
 * that runs the toolbox against itself works in.
 *
 * The working tree lives at /workspace inside the codeceptjs container (tarred
 * in by `task project:test:e2e`, without .git). Copying it whole is what makes a
 * `task ...` run inside the copy real: the root Taskfile needs every include it
 * declares. The heavy, irrelevant trees are dropped so the copy stays light.
 */
const fs = require('fs')
const path = require('path')
const { execSync, execFileSync } = require('child_process')

const REPO = '/workspace'

function copyFramework (dir) {
  execSync(
    `tar -C ${REPO} --exclude=.git --exclude=node_modules --exclude=.cache --exclude=tmp ` +
    '--exclude=megalinter-reports --exclude="project/tests/e2e/screenshots" ' +
    `--exclude="project/tests/e2e/_output" -cf - . | tar -C ${dir} -xf -`
  )
}

// The copy as a fresh git repository on main, ready for a story's commits: the
// committed film left out (25 MB nobody renders there), and owned by the test's
// user, because tar keeps the host uid and git refuses another user's tree.
function toolboxRepository (dir) {
  copyFramework(dir)
  fs.rmSync(path.join(dir, 'project/tests/e2e/storyboards'), { recursive: true, force: true })
  execFileSync('chown', ['-R', `${process.getuid()}:${process.getgid()}`, dir])
  for (const args of [
    ['init', '--quiet', '--initial-branch=main'],
    ['config', 'user.email', process.env.TASK_GITLAB_LAMBDA_EMAIL || 'lambda@test.local'],
    ['config', 'user.name', 'Lambda User'],
    ['config', 'core.hooksPath', '/dev/null']
  ]) execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' })
  return dir
}

/**
 * A fresh copy at `dir` that can run the test engine itself: the engine's
 * dependencies are baked into the image, never carried in the tree, so the copy
 * borrows the image's, exactly what the runner uses. The committed storyboards
 * (tens of MB of SVG) are left out: no nested run reads them. The files belong
 * to whoever extracts them, so git trusts the copy without a safe.directory.
 */
function copyFrameworkWithEngine (dir) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  execSync(
    `tar -C ${REPO} --exclude=.git --exclude=node_modules --exclude=.cache --exclude=tmp ` +
    '--exclude=megalinter-reports --exclude="project/tests/e2e/screenshots" --exclude="project/tests/e2e/storyboards" ' +
    `--exclude="project/tests/e2e/_output" -cf - . | tar -C ${dir} --no-same-owner -xf -`
  )
  fs.symlinkSync('/app/.config/codeceptjs/node_modules', path.join(dir, '.config/codeceptjs/node_modules'))
}

/**
 * The line `task project:test:e2e` ends on inside the test container, read from
 * the task's own preview in `cwd`, so a card can never show a command the task
 * no longer runs. The task itself cannot run there: it drives the very
 * container the suite runs in.
 */
function engineCommand (cwd, env, { workers = 1, args = '' } = {}) {
  const preview = execSync(`task --dry project:test:e2e TASK_E2E_WORKERS=${workers} -- ${args} 2>&1`, { cwd, env, encoding: 'utf8' })
  const line = preview.split('\n').find(l => l.includes('codeceptjs run-workers'))
  if (!line) throw new Error('The task preview did not expose its engine command:\n' + preview)
  return line.slice(line.indexOf(' codeceptjs ') + ' codeceptjs '.length).replace(/\s+/g, ' ').trim()
}

module.exports = { REPO, copyFramework, copyFrameworkWithEngine, engineCommand, toolboxRepository }
