/**
 * `task code` and the code stage of the pipeline run the same checks: the
 * first on the developer's machine, the second as one parallel CI job per
 * check. Nothing tied the two lists together, so a check added to one could
 * silently miss the other (issue #2).
 *
 * This test reads both lists where they are written, the default task of
 * .config/devsecops/Taskfile.code.yml and the task each job of
 * .config/gitlab/ci/devsecops/code.yml.jinja runs, and requires the same
 * checks on both sides. MegaLinter is the one check each side starts its own
 * way (megalinter:npx on a machine, megalinter:ci in a job), so the variant
 * after "megalinter:" is left out. Run in the suite's container, where
 * /workspace holds the repository:
 *
 *   node --test project/tests/unit/code-ci-jobs.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = fs.existsSync('/workspace/.config/devsecops/Taskfile.code.yml') ? '/workspace' : path.resolve(__dirname, '../../..')
const read = (file) => fs.readFileSync(path.join(REPO, file), 'utf8')
const check = (name) => name.replace(/^megalinter:.*/, 'megalinter')

// The tasks the default task of the code phase calls, in its cmds list only.
function localChecks () {
  const taskfile = read('.config/devsecops/Taskfile.code.yml')
  const body = taskfile.split(/^ {2}default:\n/m)[1].split(/^ {2}\S/m)[0]
  return [...body.matchAll(/^ {6}- task: :(\S+)$/gm)].map(m => check(m[1]))
}

// The task each code:* job runs, after any VAR=value it sets for that run.
function ciChecks () {
  const pipeline = read('.config/gitlab/ci/devsecops/code.yml.jinja')
  return [...pipeline.matchAll(/^ {4}- (?:[A-Z_]+=\S+ )*task (\S+)$/gm)].map(m => check(m[1]))
}

test('@code-ci-jobs the pipeline runs every check task code runs, and no other', () => {
  const local = localChecks()
  const ci = ciChecks()
  assert.ok(local.length > 0 && ci.length > 0, `Both lists must be read:\nlocal ${local}\nci ${ci}`)
  const missingInCi = local.filter(name => !ci.includes(name))
  const missingLocally = ci.filter(name => !local.includes(name))
  assert.deepEqual(missingInCi, [], `task code runs checks no code:* job runs: ${missingInCi.join(', ')}`)
  assert.deepEqual(missingLocally, [], `code:* jobs run checks task code does not: ${missingLocally.join(', ')}`)
})
