@e2e
Feature: Trusting the installer on a fresh machine
  As a developer trying the DevSecOps Toolbox on a brand-new machine
  I want the installer to refuse cleanly when it cannot work, add the tools it
  is missing by itself, and keep working even when I run it the short
  documented way (piped into bash)
  So that I can trust it from a cold start, whichever way I launch it

  # ONE story in three chapters, each in its OWN fresh sandbox (they never
  # share state). ONE Gherkin sentence = ONE card = ONE pixel baseline,
  # asserted inside the step (tolerance: 0); each result card twins its frame
  # with a check of the same fact — an exit code, a line in the install log,
  # or the GitLab API.
  #
  # Chapter 1 — the hardest exit first: on a machine without curl the
  # installer cannot fetch its toolchain, so it must refuse at its very first
  # check and say what to install. Pure container + installer, no GitLab and
  # no network — it stops before any download.
  # Chapter 2 — a barren Ubuntu machine with only sudo and curl: the installer
  # adds the one tool it is missing (unzip) with sudo, then stops on purpose
  # because the project has no GitLab link yet, printing the exact next step.
  # Nothing here touches GitLab, so the proofs read the captured output.
  # Chapter 3 — the documented one-liner (curl ... | bash): piping hides the
  # real terminal, so the installer reads your keystrokes through /dev/tty and
  # stays interactive all the way to the finished screen and the framework
  # merge request (the page where changes get reviewed before joining main).
  @fresh-machine
  Scenario: The installer refuses cleanly, fixes its own gaps, and stays interactive even when piped
    # Chapter: Without curl, the installer refuses cleanly
    # Note: A barren Ubuntu machine with no curl. The installer needs curl to download its toolchain, so this is the first thing it checks.
    # Copy: command -v curl || echo "curl: command not found"
    Given a fresh machine without curl, with the installer ready to run
    # Note: The developer launches the installer the usual way. It prints its banner and starts its checks.
    # Copy: bash install.sh
    When the installer runs on that machine
    # Note: The installer stops at the very first check, names the missing tool, and tells the developer to install curl and rerun. It exits with an error, before touching anything.
    # Copy: echo $?  # 1
    Then the installer stops and says curl must be installed first
    # Chapter: A bare machine sets itself up
    # Note: This machine has sudo and curl but no unzip — the tool the installer will have to add by itself. The installer files are copied in but not started yet.
    # Copy: command -v unzip
    Given a fresh machine has only sudo and curl, with the installer ready to run
    # Note: The installer starts and prints its title. Nothing on the machine has changed yet.
    # Copy: sh -c "mkdir -p /workspace/my-project && cd /workspace/my-project && yes '' | head -n 40 | bash /tmp/install.sh"
    When the installer runs on the fresh machine with no one to answer its questions
    # Note: task devsecops:init fails because unzip is missing, so the installer adds unzip with sudo and runs again.
    # Copy: grep -A2 "Attempting to install missing prerequisites" /tmp/install.log
    Then the installer installs the tool it was missing and tries again
    # Note: The installer stops on purpose: the project has no GitLab link yet, so it prints the exact next step. If this message ever went missing, a new developer would be stuck.
    # Copy: No 'origin' remote configured. Add a GitLab remote, then re-run.
    And the installer stops and explains how to link the project to GitLab
    # Chapter: The one-line install stays interactive
    # Note: The empty copy, with the installer ready to run the documented way — piped into bash (the output of one command fed straight into the next). Set up off-screen: the test user, the tools, and the GitLab login.
    # Copy: curl -fsSL http://gitlab/<toolbox>/install.sh | bash
    Given a developer follows the README and pipes the installer into bash
    # Note: Even when piped into bash, the installer still reaches its first question: it reads your keystrokes through /dev/tty, so the documented one-line command still lets you answer.
    # Copy: bash /tmp/devsecops-install.sh
    When the installer still asks what to install, even when piped into bash
    # Note: Answering through the pipe builds and finishes exactly like typing the command by hand.
    Then the piped install finishes and opens the framework merge request
