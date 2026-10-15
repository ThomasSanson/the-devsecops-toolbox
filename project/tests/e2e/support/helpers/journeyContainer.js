/**
 * Fresh Ubuntu ttyd container for the developer-journey scenarios.
 *
 * Unlike freshUbuntu.js (which docker-cp's the whole self-hosting repo and
 * runs `task devsecops:init` directly), the journey scenarios reproduce the
 * REAL onboarding flow: a developer clones their OWN blank project from the
 * in-repo TEST GitLab (gitlab/gitlab-ce, reachable at http://gitlab over the
 * shared `the-devsecops-toolbox` network), then runs the toolbox installer
 * which scaffolds the project via Copier from the WORKING-BRANCH template
 * (never curl-from-main).
 *
 * The prebuilt `ubuntu` image bakes ttyd with `rendererType=dom`
 * (project/ubuntu/Dockerfile) so the live terminal can be screenshotted as
 * the developer truly sees it.
 */
const {
  shellEscape,
  runCommand,
  containerName,
  execInContainer,
  execInContainerAsUser,
  removeContainer,
  waitForTtyd
} = require('./docker')
const { prepareCspellMigrationTemplate, prepareVersionedTemplate, removeRendered } = require('./copierRender')

const CONTAINER_WORKDIR = '/workspace'
const PROJECT_DIR = '/workspace/my-project'
const TEMPLATE_DIR = '/tmp/toolbox-template'
const INSTALLER_PATH = '/tmp/install.sh'
const INSTALL_LOG = '/tmp/install.log'
const WRAPPER_PATH = '/tmp/devsecops-install.sh'
const TTYD_READY_TIMEOUT = 30000
const SETUP_TIMEOUT = 300000

/**
 * Spawn a fresh Ubuntu ttyd container and clone the (blank) test-GitLab
 * project `projectName` into PROJECT_DIR as the bootstrap user, then serve an
 * interactive bash session rooted there. Returns the container name (caller
 * tears it down).
 *
 * The clone uses the lambda personal access token over HTTP; the credentialed
 * URL only lands in .git/config and is never rendered in the captured
 * terminal (scenarios display `git status`, not `git remote -v`).
 */
function setupClonedProjectTerminal (projectName, cloneToken) {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const encodedToken = encodeURIComponent(cloneToken)
  const cloneUrl = `http://${lambdaUser}:${encodedToken}@gitlab/${lambdaUser}/${projectName}.git` // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
  const name = containerName()

  runCommand(
    `cd ${CONTAINER_WORKDIR}/project && docker compose run -d --name ${shellEscape(name)} ubuntu`,
    { timeout: SETUP_TIMEOUT }
  )

  const clone = execInContainerAsUser(name, 'bootstrap', [
    'git config --global user.email "lambda@test.local"',
    'git config --global user.name "Lambda"',
    'git config --global init.defaultBranch main',
    `git clone ${shellEscape(cloneUrl)} ${PROJECT_DIR}`,
    // CI runners exec under umask 000, so the clone leaves the project dir and
    // .git world-writable (0777) and `ls`/`tree` colour them green-on-green
    // instead of the plain blue a 0755 dir gets (`tree` shows the project dir
    // itself as its leading "."). A permission drift, not a rendering one, that
    // breaks the storyboard baseline between local and CI. Same class of fix as
    // the agent-mode 0755 pin in install.sh.
    `chmod 755 ${PROJECT_DIR} ${PROJECT_DIR}/.git`,
    `git config --global --add safe.directory ${PROJECT_DIR}`
  ].join('\n'), { timeout: SETUP_TIMEOUT })
  if (clone.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to clone "${projectName}" into journey container:\n${clone.output}`)
  }

  // Start ttyd as the bootstrap user, rooted in the cloned project so the
  // prompt path (and thus the baseline) is stable.
  const ttydStart = execInContainerAsUser(name, 'bootstrap', [
    `cd ${PROJECT_DIR} && nohup ttyd -p 7681 -W -t scrollback=5000 -t rendererType=dom bash >/tmp/ttyd.log 2>&1 &`,
    'sleep 1'
  ].join('\n'))
  if (ttydStart.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to start ttyd:\n${ttydStart.output}`)
  }

  waitForTtyd(name, TTYD_READY_TIMEOUT)
  return name
}

/**
 * Stage the WORKING-BRANCH installer inside the journey container: the real
 * `.config/devsecops/install.sh`, plus the working-branch repo as a
 * copier-usable template at TEMPLATE_DIR.
 *
 * The runner's /workspace is the working-branch repo already tarred WITHOUT
 * .git by project:test:e2e, so copying it gives a plain (non-git) template
 * directory whose exact bytes — uncommitted edits included — are what Copier
 * renders. This is what makes the journey test the CURRENT branch rather than
 * curl-from-main.
 */
function prepareWorkingBranchInstaller (name) {
  runCommand(
    `docker cp ${shellEscape(`${CONTAINER_WORKDIR}/.config/devsecops/install.sh`)} ${shellEscape(`${name}:${INSTALLER_PATH}`)}`
  )

  const mk = execInContainerAsUser(name, 'bootstrap', `mkdir -p ${TEMPLATE_DIR}`)
  if (mk.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to create template dir in journey container:\n${mk.output}`)
  }

  runCommand(
    `docker cp ${shellEscape(`${CONTAINER_WORKDIR}/.`)} ${shellEscape(`${name}:${TEMPLATE_DIR}`)}`,
    { timeout: SETUP_TIMEOUT }
  )

  const fix = execInContainer(
    name,
    `chown -R bootstrap:bootstrap ${INSTALLER_PATH} ${TEMPLATE_DIR}`,
    { user: 'root' }
  )
  if (fix.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to fix installer ownership in journey container:\n${fix.output}`)
  }

  // Wrapper that runs install.sh under `script`, recording the FULL session to
  // INSTALL_LOG (kept as a debug artifact) while keeping the terminal fully
  // interactive so the Copier questions render live for visual capture. The
  // typed command stays clean (`bash /tmp/devsecops-install.sh`), and a
  // variable typed in front of it (TASK_DEVSECOPS_INIT_DIRECT=true) reaches
  // the installer through `script`.
  const runCommand_ = `DEVSECOPS_TEMPLATE_URL=${TEMPLATE_DIR} bash ${INSTALLER_PATH}`
  const wrapper = execInContainerAsUser(name, 'bootstrap', [
    `cat > ${WRAPPER_PATH} <<'EOF'`,
    '#!/bin/sh',
    `exec script -qfc "${runCommand_}" ${INSTALL_LOG}`,
    'EOF',
    `chmod +x ${WRAPPER_PATH}`
  ].join('\n'))
  if (wrapper.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to write installer wrapper in journey container:\n${wrapper.output}`)
  }
}

/**
 * Pre-install and authenticate glab against the test GitLab so that
 * `task devsecops:init` (run by the installer) passes glab:auth:ensure and
 * proceeds to configure the project (tokens, CI/CD vars, merge settings,
 * protected branch). Mirrors the init-baseline auth (workspaceRepo.js).
 */
function authenticateGlab (name, token) {
  const result = execInContainerAsUser(name, 'bootstrap', [
    'export PATH="$HOME/.local/bin:$PATH"',
    `bash ${TEMPLATE_DIR}/.config/glab/install.sh`,
    `glab auth login --hostname gitlab --token ${shellEscape(token)} --api-protocol http --api-host gitlab:80 --git-protocol http`
  ].join('\n'), { timeout: SETUP_TIMEOUT })
  if (result.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to authenticate glab in journey container:\n${result.output}`)
  }
}

/**
 * Live terminal on a project GENERATED from a versioned template, the way a real
 * repository sits just before a toolbox update: the template is docker-cp'd in
 * with its tags, rendered at `vcsRef`, and committed as `commitMessage`.
 * `ownCommit` ({ commands, message }) is the developer's own work, run inside
 * the project and committed on top; `push` ({ remote, user, token }) then
 * publishes main to the test GitLab. The token goes to git's credential store,
 * never into the remote URL: a push on camera prints the URL it pushed to.
 * Returns the container name (caller tears it down).
 */
function setupGeneratedProjectTerminal ({ template, vcsRef, commitMessage, ownCommit = null, push = null }) {
  const name = containerName()

  runCommand(
    `cd ${CONTAINER_WORKDIR}/project && docker compose run -d --name ${shellEscape(name)} ubuntu`,
    { timeout: SETUP_TIMEOUT }
  )
  runCommand(
    `docker cp ${shellEscape(template)} ${shellEscape(`${name}:${TEMPLATE_DIR}`)}`,
    { timeout: SETUP_TIMEOUT }
  )

  const setup = execInContainerAsUser(name, 'bootstrap', [
    'set -e',
    'export PATH="$HOME/.local/bin:$PATH"',
    'mkdir -p "$HOME/.local/bin"',
    // uv (Python/Copier launcher) and go-task: the toolbox runs Copier via Taskfile,
    // so `task devsecops:update` is the REAL update command — task must be present.
    'curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1',
    'sh -c "$(curl -fsSL https://taskfile.dev/install.sh)" -- -d -b "$HOME/.local/bin" >/dev/null 2>&1',
    'git config --global user.email "lambda@test.local"',
    'git config --global user.name "Lambda"',
    'git config --global init.defaultBranch main',
    // the template was docker-cp'd in, so its checkout belongs to another uid; mark
    // it safe so Copier can read its tags and honour --vcs-ref (else it falls back
    // to the working tree, i.e. the NEW layout, and the "before" would be wrong).
    "git config --global --add safe.directory '*'",
    // render the project at the OLD release from the versioned template, exactly
    // where a real repo would sit before a toolbox update.
    `uvx --python 3.14 --from copier==9.14.3 copier copy ${TEMPLATE_DIR} ${PROJECT_DIR} --vcs-ref ${vcsRef} --defaults --trust --skip-tasks --quiet`,
    `cd ${PROJECT_DIR}`,
    `git init -q && git add -A && git commit -q --no-verify -m ${shellEscape(commitMessage)}`,
    ...(ownCommit ? [...ownCommit.commands, `git add -A && git commit -q --no-verify -m ${shellEscape(ownCommit.message)}`] : []),
    ...(push
      ? [
          'git config --global credential.helper store',
          `printf '%s\\n' ${shellEscape(`http://${push.user}:${encodeURIComponent(push.token)}@gitlab`)} > "$HOME/.git-credentials"`, // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
          'chmod 600 "$HOME/.git-credentials"',
          `git remote add origin ${shellEscape(push.remote)}`,
          'git push -q -u origin main'
        ]
      : [])
  ].join('\n'), { timeout: SETUP_TIMEOUT })
  if (setup.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to set up the generated-project terminal:\n${setup.output}`)
  }

  // No TASK_COPIER_ANSWER_FILE export here, on purpose. Exporting it used to
  // make the update work in this terminal and nowhere else: a real project has
  // no such variable, so Renovate's command died on the task precondition and
  // every framework-evolution merge request arrived empty. The task the
  // developer types now carries the answers file itself (#178).
  const ttydStart = execInContainerAsUser(name, 'bootstrap', [
    `cd ${PROJECT_DIR} && nohup ttyd -p 7681 -W -t scrollback=5000 -t rendererType=dom bash >/tmp/ttyd.log 2>&1 &`,
    'sleep 1'
  ].join('\n'))
  if (ttydStart.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to start ttyd in the generated-project terminal:\n${ttydStart.output}`)
  }

  waitForTtyd(name, TTYD_READY_TIMEOUT)
  return name
}

/**
 * Live terminal for the toolbox-update story: a project generated at release
 * 22.0.0 of the cspell-migration template (one shared dictionary file, before
 * the split), the developer's own commit on top, pushed to its test-GitLab
 * project, with glab authenticated. That is where a developer stands when a new
 * toolbox release is out and they ask for it themselves. Nothing is exported
 * into the session: `task devsecops:update` has to find the answers file on its
 * own, like it does in a real repository.
 */
function setupToolboxUpdateTerminal (projectName, pushToken, { commitMessage, ownCommit }) {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const template = prepareCspellMigrationTemplate()
  try {
    const name = setupGeneratedProjectTerminal({
      template,
      vcsRef: '22.0.0',
      commitMessage,
      ownCommit,
      push: { remote: `http://gitlab/${lambdaUser}/${projectName}.git`, user: lambdaUser, token: pushToken } // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
    })
    authenticateGlab(name, pushToken)
    return name
  } finally {
    // The container holds its own copy now.
    removeRendered(template)
  }
}

/**
 * Live terminal for the retired-linters story: a project generated at release
 * 1.0.0 of a two-release template and pushed to its test-GitLab project,
 * sitting on main with glab authenticated. Nothing is exported into the
 * session: `task devsecops:update` has to find the answers file on its own,
 * like it does in a real repository.
 */
function setupManualUpdateTerminal (projectName, pushToken) {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const template = prepareVersionedTemplate()
  try {
    const name = setupGeneratedProjectTerminal({
      template,
      vcsRef: '1.0.0',
      commitMessage: 'chore: project generated from an earlier toolbox release',
      push: { remote: `http://gitlab/${lambdaUser}/${projectName}.git`, user: lambdaUser, token: pushToken } // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
    })
    authenticateGlab(name, pushToken)
    return name
  } finally {
    // The container holds its own copy now.
    removeRendered(template)
  }
}

/**
 * Pre-install the bootstrap toolchain (task, uv, gum, glow) so that when the
 * installer runs on-camera its toolchain step is a handful of "already
 * installed" lines (dropped from the capture as non-deterministic noise) rather
 * than a wall of download output — which lets the agent-mode screenshot start at
 * the blank-repo "before" line and still tell the whole before/during/after story
 * deterministically. Reuses install.sh's OWN installers (strip its `main`
 * invocation, source the rest, call the toolchain functions) so there is no
 * duplicated download logic and no version drift. Requires the installer to be
 * staged first (prepareWorkingBranchInstaller).
 */
function preinstallToolchain (name) {
  const result = execInContainerAsUser(name, 'bootstrap', [
    'export PATH="$HOME/.local/bin:$PATH"',
    'mkdir -p "$HOME/.local/bin"',
    `grep -v '^main "' ${INSTALLER_PATH} > /tmp/toolchain-lib.sh`,
    'sh -c ". /tmp/toolchain-lib.sh; install_task; install_uv; install_ui_tools"'
  ].join('\n'), { timeout: SETUP_TIMEOUT })
  if (result.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to pre-install the toolchain in journey container:\n${result.output}`)
  }
}

/**
 * A brand-new machine for the @fresh-machine story: the compose `ubuntu`
 * image with curl, git and unzip taken off again, an empty project folder,
 * the working-branch installer at INSTALLER_PATH (and its template), and a
 * live terminal in that folder. The whole session is recorded to INSTALL_LOG
 * (the programmatic twin of what scrolled by), and DEVSECOPS_TEMPLATE_URL
 * points the installer at the working-branch template without showing on
 * screen. Returns the container name (caller tears it down).
 */
function setupBareMachineTerminal () {
  const name = containerName()
  runCommand(
    `cd ${CONTAINER_WORKDIR}/project && docker compose run -d --name ${shellEscape(name)} ubuntu`,
    { timeout: SETUP_TIMEOUT }
  )
  const bare = execInContainer(
    name,
    `apt-get purge -y -qq curl git unzip >/dev/null 2>&1 && install -d -o bootstrap -g bootstrap ${PROJECT_DIR}`,
    { user: 'root' }
  )
  if (bare.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to strip the fresh machine:\n${bare.output}`)
  }
  prepareWorkingBranchInstaller(name)
  const ttydStart = execInContainerAsUser(name, 'bootstrap', [
    `cd ${PROJECT_DIR} && DEVSECOPS_TEMPLATE_URL=${TEMPLATE_DIR} nohup ttyd -p 7681 -W -t scrollback=5000 -t rendererType=dom script -qfc bash ${INSTALL_LOG} >/tmp/ttyd.log 2>&1 &`,
    'sleep 1'
  ].join('\n'))
  if (ttydStart.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to start ttyd on the fresh machine:\n${ttydStart.output}`)
  }
  waitForTtyd(name, TTYD_READY_TIMEOUT)
  return name
}

function teardownJourneyTerminal (name) {
  if (!name) return
  removeContainer(name)
}

module.exports = {
  CONTAINER_WORKDIR,
  PROJECT_DIR,
  TEMPLATE_DIR,
  INSTALLER_PATH,
  INSTALL_LOG,
  WRAPPER_PATH,
  setupClonedProjectTerminal,
  setupBareMachineTerminal,
  setupManualUpdateTerminal,
  setupToolboxUpdateTerminal,
  prepareWorkingBranchInstaller,
  preinstallToolchain,
  authenticateGlab,
  teardownJourneyTerminal
}
