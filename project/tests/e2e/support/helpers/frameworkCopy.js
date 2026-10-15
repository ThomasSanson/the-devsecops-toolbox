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

module.exports = { REPO, copyFramework, toolboxRepository }
