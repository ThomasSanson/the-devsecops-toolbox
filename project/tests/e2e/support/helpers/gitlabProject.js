/**
 * Give a story a real GitLab ending in seconds: a local tree (a render, a repo
 * built by the story) becomes a project of the lambda user, ready for the
 * gitlabCard pages (tree, file, commits, compare). No runner involved: a REAL
 * pipeline still needs pipelineRunner.registerScopedRunner.
 *
 *   const pub = await publishToGitLab(dir, { name: 'e2e-render' })
 *   await gitlabFrame(I, 'rendered-tree', gitlabUrl.tree(pub.projectName), { projectNames: [pub.projectName] })
 *   ...
 *   await pub.teardown()   // in the story's After
 *
 * The token travels in the push URL only, and a failed git command is reported
 * without its arguments, so the token never reaches a log.
 */
const crypto = require('crypto')
const fs = require('fs')
const { execFileSync } = require('child_process')
const {
  getRootHeaders,
  createProject,
  deleteProject,
  createLambdaPersonalAccessToken,
  revokePersonalAccessToken
} = require('./gitlabApi')

function git (dir, args, what) {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (_) {
    // execFileSync puts its arguments in the error, and a push URL carries the token.
    throw new Error(`publishToGitLab: git ${what} failed in ${dir}`)
  }
}

/**
 * dir: a git repository (its HEAD is pushed as is) or a plain directory (it is
 * committed first, as one commit named `message`).
 * project: extra fields for the create-project call (shared_runners_enabled…);
 * Auto DevOps is off unless asked, so no stray pipeline repaints a card.
 * pushOptions: e.g. ['ci.skip']. On GitLab 19.4 ci.skip still records a
 * "skipped" pipeline, which shows its own status icon on the commit.
 * Returns { projectName, projectId, headers, token, tokenId, push(branch), teardown() }:
 * projectName is GitLab's PATH for `name` (lower case, no spaces). A card shows
 * the name itself in the sidebar, so a `name` that differs from its path goes
 * in projectNames too.
 * Anything that fails after the project exists deletes it again before throwing.
 */
async function publishToGitLab (dir, {
  name = `e2e-published-${crypto.randomBytes(4).toString('hex')}`,
  visibility = 'public',
  branch = 'main',
  message = 'chore: initial commit',
  project = {},
  pushOptions = []
} = {}) {
  const root = await getRootHeaders()
  const { token, id: tokenId } = await createLambdaPersonalAccessToken(`publish-${name}`, ['api', 'write_repository'], root)
  const headers = { 'PRIVATE-TOKEN': token }
  const created = await createProject(
    { name, visibility, initialize_with_readme: false, auto_devops_enabled: false, ...project },
    headers
  )
  if (created.status >= 400) {
    await revokePersonalAccessToken(tokenId, root).catch(() => {})
    throw new Error(`publishToGitLab: creating "${name}" returned ${created.status}: ${JSON.stringify(created.data)}`)
  }
  // GitLab's own path, not the name asked for: it is what URLs and the API take.
  const projectName = created.data.path
  const teardown = async () => {
    await deleteProject(projectName, root).catch(() => {})
    await revokePersonalAccessToken(tokenId, root).catch(() => {})
  }

  try {
    // A directory INSIDE another repository is not a repository of its own:
    // pushing its HEAD would publish the parent.
    let isRepo = false
    try {
      const top = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      isRepo = fs.realpathSync(top) === fs.realpathSync(dir) &&
        Boolean(execFileSync('git', ['-C', dir, 'rev-parse', '--verify', '--quiet', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim())
    } catch (_) {}
    if (!isRepo) {
      git(dir, ['init', '--quiet', `--initial-branch=${branch}`], 'init')
      git(dir, ['config', 'user.email', process.env.TASK_GITLAB_LAMBDA_EMAIL || 'lambda@test.local'], 'config')
      git(dir, ['config', 'user.name', 'Lambda User'], 'config')
      // A fixture commit: the hooks a rendered project installs are another story's subject.
      git(dir, ['config', 'core.hooksPath', '/dev/null'], 'config')
      git(dir, ['add', '-A'], 'add')
      git(dir, ['commit', '--quiet', '-m', message], 'commit')
    }

    const user = process.env.TASK_GITLAB_LAMBDA_USER
    const remote = new URL(`http://gitlab/${created.data.path_with_namespace}.git`) // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
    remote.username = user
    remote.password = token
    const push = (target = branch) => git(
      dir,
      ['push', '--quiet', ...pushOptions.flatMap(o => ['-o', o]), remote.href, `HEAD:refs/heads/${target}`],
      `push to ${target}`
    )
    push(branch)

    return { projectName, projectId: created.data.id, headers, token, tokenId, push, teardown }
  } catch (err) {
    // The caller never gets teardown() from a throw: clean up here.
    await teardown()
    throw err
  }
}

module.exports = { publishToGitLab }
