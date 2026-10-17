# cspell:ignore setsid -- the tool that runs the installer without a terminal
@e2e
Feature: Trusting the installer on a fresh machine
  As a developer trying the DevSecOps Toolbox on a brand-new machine
  I want the installer to refuse cleanly when it cannot work, ask before it
  installs anything, add what else it is missing, and say what to do next
  So that I can trust it from a cold start, even with the one-line install
  piped into bash

  # ONE bare machine, ONE terminal session, ONE arc: each stop gives advice,
  # and the next card follows it. Chapter 1: without curl the installer stops
  # at its first check. Chapter 2: curl installed as told, the README
  # one-liner (curl from GitLab, piped into bash) asks before each tool it adds
  # (the keystrokes reach it through /dev/tty while bash reads the pipe), the
  # setup adds unzip with sudo by itself, and the run stops because the folder
  # has no GitLab remote. Chapter 3: the remote added as told, the setup opens
  # the framework merge request on GitLab. Chapter 4: the same installer with
  # no terminal at all, as in a CI job, asks nothing and finishes on its own.
  #
  # ONE sentence = ONE card = ONE pixel baseline, asserted inside the step
  # (tolerance: 0). Every card is twinned with a check of the same fact: the
  # screen, the session log, the machine itself or the GitLab API.
  @fresh-machine
  Scenario: The installer refuses cleanly, sets up a bare machine through the pipe, and says what to do next
    # Chapter: Without curl, the installer refuses cleanly
    # Note: A brand-new Ubuntu machine, with the installer file copied onto it. One typed line: "type" answers "not found" for curl, git and unzip, then the installer runs.
    # Note: It prints its title and stops at its very first check: "curl is required but not installed." It says to install curl and run it again, and exits with code 1 before changing anything.
    # Copy: type curl git unzip; bash /tmp/install.sh; echo "exit code: $?"
    When the developer runs the installer on a fresh machine without curl, it stops at its first check and says to install curl first
    # Chapter: The one-line install sets up the bare machine
    # Note: The same terminal, cleared. The developer installs curl with sudo, as told, then runs the one-line install from the README: curl downloads the installer from GitLab and bash runs it straight from the pipe. The test GitLab serves it the way gitlab.com does.
    # Note: The installer says Git is required, at least version 2.34.0, and waits on "Install Git now? [Y/n]:". Bash is reading the script from the pipe, so the installer reads the answer from the keyboard instead.
    # Copy: sudo apt-get update && sudo apt-get install -y curl && curl -fsSL https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/raw/main/.config/devsecops/install.sh | bash
    When the developer installs curl and pipes the installer from GitLab into bash, the installer asks before installing Git
    # Note: The developer pressed Enter on each question, which means yes: Git, then task, then uv. This card starts at the last plain question, "Install gum and glow?", plain because gum is the tool that would make it pretty.
    # Note: Once both are installed, the installer lists its two choices, "Complete framework" and "Choose components", and asks "Install the complete DevSecOps framework?". Version numbers show as v<version>, since they move with each release.
    And the installer asks before adding gum and glow, then asks what to install, all through the pipe
    # Note: The developer keeps the complete framework and presses Enter on every Copier question. The installer builds the project, then runs its setup, task devsecops:init, and the output scrolls on for minutes.
    # Note: This part scrolled by on the way: the setup says "unzip is required before task devsecops:init.", installs it with sudo on its own, and ends on "unzip installed successfully!". Apt's progress lines are left out.
    Then the setup finds unzip missing and installs it with sudo by itself
    # Note: The end of the run. The setup reaches "Configuring GitLab project..." and its GitLab sign-in check, glab:auth:ensure, stops it: "No 'origin' remote configured. Add a GitLab remote, then re-run." The folder is not linked to any GitLab project, so the framework has nowhere to go yet.
    # Note: The developer then types echo "exit code: $?": the run ended with exit code 201, and the prompt is back.
    And the installer stops and says the project needs a GitLab remote
    # Chapter: Following that advice opens the merge request
    # Note: In the same terminal, the developer turns the folder into a git repository, adds an empty GitLab project as its origin remote and runs the setup again. The sign-in to GitLab with glab was done off screen.
    # Note: GitLab's page for the merge request the setup opened: "chore: initialize devsecops framework", Open, from the init-framework-devsecops branch into the main branch. The project's random name shows as "project". The merge box and the tab counters are hidden, as they follow the pipelines GitLab starts on its own.
    # Copy: git init && git remote add origin https://gitlab.com/<namespace>/<project>.git && task devsecops:init
    Then once the developer links the folder to a GitLab project and runs the setup again, GitLab shows the framework merge request into the main branch
    # Chapter: With no terminal at all, nothing is asked
    # Note: A new empty folder on the same machine, and one typed line that runs the installer the way a CI job does: setsid leaves it no terminal, </dev/null leaves it nothing to read, and TASK_GLAB_ENABLED=false skips the GitLab part, as the README advises for a folder with no GitLab project.
    # Note: Nobody answers anything and everything goes to /tmp/ci.log. The run ends with exit code 0, and the log ends on "Installation complete!" and "Run 'task' to see available commands."
    # Copy: TASK_GLAB_ENABLED=false setsid -w bash /tmp/install.sh </dev/null >/tmp/ci.log 2>&1; echo "exit code: $?"; tail -n 3 /tmp/ci.log
    Then on a machine with no terminal at all, as in a CI job, the same installer asks nothing and installs the complete framework

  # .config/task/install.sh is the script Copier and the CI jobs run to get
  # task. Without write access to /usr/local/bin and without passwordless sudo,
  # it used to print "Trying anyway..." and fail on /usr/local/bin (issue #138).
  # The bare machine of the story above, with its sudo rights taken away: one
  # terminal, the setup on the first card and the install on the second.
  @task-install-without-sudo
  Scenario: Without sudo rights, the task installer puts task in the developer's own folder
    # Note: A brand-new Ubuntu machine where the developer has no sudo rights, with the toolbox's task installer in .config/task. One typed line: sudo asks for a password, /usr/local/bin belongs to root, and task is not installed.
    # Copy: sudo -n true; stat -c '%A %U %n' /usr/local/bin; type task
    Given a fresh machine where the developer has no sudo rights and task is not installed
    # Note: The developer runs the task installer. It cannot write to /usr/local/bin and has no sudo, so it says it installs into /home/bootstrap/.local/bin instead, the developer's own folder. The lines after it come from task's official install script, which ends on "installed /home/bootstrap/.local/bin/task".
    # Note: The installer then says where task is and that this folder must be on the PATH. The run ends with exit code 0, and the shell finds task in /home/bootstrap/.local/bin. Versions show as <version>, the download progress and the temporary folder as placeholders: they change with each run or update.
    # Copy: sh .config/task/install.sh; echo "exit code: $?"; command -v task; task --version
    Then the task installer puts task in ~/.local/bin, says that folder must be on the PATH, and task runs from there
