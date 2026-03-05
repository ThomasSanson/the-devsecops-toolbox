const { execSync } = require('child_process')

function buildGitLabTaskEnv (glabToken) {
  return {
    ...process.env,
    PATH: `${process.env.PATH}:${process.env.HOME}/.local/bin`,
    GITLAB_HOST: 'gitlab',
    GITLAB_TOKEN: glabToken,
    GLAB_TEST_TOKEN: glabToken
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

    task dev:setup-environment

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

module.exports = {
  buildGitLabTaskEnv,
  bootstrapWorkspaceRepo,
  runTaskInRepo
}
