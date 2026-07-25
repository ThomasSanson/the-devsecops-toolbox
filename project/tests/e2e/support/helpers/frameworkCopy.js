/**
 * A throwaway, writable copy of the framework — the "safe zone" every scenario
 * that runs the toolbox against itself works in.
 *
 * The working tree lives at /workspace inside the codeceptjs container (tarred
 * in by `task project:test:e2e`, without .git). Copying it whole is what makes a
 * `task ...` run inside the copy real: the root Taskfile needs every include it
 * declares. The heavy, irrelevant trees are dropped so the copy stays light.
 */
const { execSync } = require('child_process')

const REPO = '/workspace'

function copyFramework (dir) {
  execSync(
    `tar -C ${REPO} --exclude=.git --exclude=node_modules --exclude=.cache --exclude=tmp ` +
    '--exclude=megalinter-reports --exclude="project/tests/e2e/screenshots" ' +
    `--exclude="project/tests/e2e/_output" -cf - . | tar -C ${dir} -xf -`
  )
}

module.exports = { REPO, copyFramework }
