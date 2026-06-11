const { execSync } = require('child_process')

function buildGitLabTaskEnv (glabToken) {
  return {
    ...process.env,
    PATH: `${process.env.PATH}:${process.env.HOME}/.local/bin`,
    GITLAB_HOST: 'gitlab',
    GITLAB_TOKEN: glabToken,
    GLAB_TEST_TOKEN: glabToken,
    // These scenarios assert the GitLab CONFIG effects of init (tokens, CI/CD
    // vars, branch protection), not the MR delivery. Run init in direct mode so
    // it does not open the init-framework-devsecops MR (that flow is covered by
    // the dedicated @e2e-init-framework-mr feature).
    TASK_DEVSECOPS_INIT_DIRECT: 'true'
  }
}

function bootstrapWorkspaceRepo (projectName, repoDir, glabToken, { runInit = false, timeout = 600000 } = {}) {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const cloneToken = encodeURIComponent(glabToken)
  const env = {
    ...buildGitLabTaskEnv(glabToken),
    PROJECT_NAME: projectName,
    REPO_DIR: repoDir,
    LAMBDA_USER: lambdaUser,
    CLONE_TOKEN: cloneToken,
    RUN_INIT: runInit ? 'true' : 'false'
  }

  execSync(`
    set -e
    export PATH="$HOME/.local/bin:$PATH"

    rm -rf "$REPO_DIR" || true
    git clone "http://$LAMBDA_USER:$CLONE_TOKEN@gitlab/$LAMBDA_USER/$PROJECT_NAME.git" "$REPO_DIR"

    cp -r /workspace/. "$REPO_DIR/"

    cd "$REPO_DIR"
    git config user.email "lambda@test.local"
    git config user.name "Lambda"

    # flock: dev:setup-environment mutates the runner's SHARED toolchain
    # (apt, nvm/node, uv pythons, go bins). Two workers running it
    # concurrently race (apt lock exit 100, tar collisions in ~/.nvm) —
    # serializing makes the first worker install and later ones fly through
    # the idempotent "already installed" checks.
    flock /tmp/e2e-dev-setup.lock task dev:setup-environment

    rm -rf ~/.config/glab-cli || true
    glab auth login \\
      --hostname gitlab \\
      --token "$GLAB_TEST_TOKEN" \\
      --api-protocol http \\
      --api-host gitlab:80 \\
      --git-protocol http

    if [ "$RUN_INIT" = "true" ]; then
      task devsecops:init
    fi
  `, {
    env,
    stdio: 'inherit',
    timeout
  })

  return buildGitLabTaskEnv(glabToken)
}

function runTaskInRepo (
  command,
  repoDir,
  glabToken,
  { stdio = 'inherit', timeout = 600000, encoding, extraEnv = {} } = {}
) {
  return execSync(command, {
    cwd: repoDir,
    env: {
      ...buildGitLabTaskEnv(glabToken),
      ...extraEnv
    },
    stdio,
    timeout,
    encoding
  })
}

function runTaskInRepoCaptured (command, repoDir, glabToken, { timeout = 600000, extraEnv = {} } = {}) {
  try {
    const output = execSync(command, {
      cwd: repoDir,
      env: { ...buildGitLabTaskEnv(glabToken), ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      encoding: 'utf8'
    })
    process.stdout.write(output)
    return { exitCode: 0, output }
  } catch (err) {
    const output = `${err.stdout || ''}${err.stderr || ''}`
    process.stdout.write(output)
    return { exitCode: err.status || 1, output }
  }
}

module.exports = {
  buildGitLabTaskEnv,
  bootstrapWorkspaceRepo,
  runTaskInRepo,
  runTaskInRepoCaptured
}
