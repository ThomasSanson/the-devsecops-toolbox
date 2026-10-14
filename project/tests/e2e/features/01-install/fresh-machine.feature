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
  # the framework merge request on GitLab.
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
    # Note: The end of the run. The setup reaches "Configuring GitLab project..." and stops: "No 'origin' remote configured. Add a GitLab remote, then re-run." The folder is not linked to any GitLab project, so the framework has nowhere to go yet.
    # Note: The prompt is back, and the project files are already in the folder. Only the delivery to GitLab is missing.
    And the installer stops and says the project needs a GitLab remote
    # Chapter: Following that advice opens the merge request
    # Note: In the same terminal, the developer turns the folder into a git repository, adds an empty GitLab project as its origin remote and runs the setup again. The sign-in to GitLab with glab was done off screen.
    # Note: GitLab's page for the merge request the setup opened: "chore: initialize devsecops framework", Open, from the init-framework-devsecops branch into the main branch. The project's random name shows as "project". The merge box and the tab counters are hidden, as they follow the pipelines GitLab starts on its own.
    # Copy: git init && git remote add origin https://gitlab.com/<namespace>/<project>.git && task devsecops:init
    Then once the developer links the folder to a GitLab project and runs the setup again, GitLab shows the framework merge request into the main branch
