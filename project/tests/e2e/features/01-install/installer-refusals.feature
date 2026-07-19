@e2e @installer-no-curl
Feature: The installer refuses cleanly when a prerequisite is missing
  As a developer on a bare machine
  I want the installer to stop with a clear reason when a required tool is
  missing, instead of failing halfway through
  So that I know exactly what to install before trying again.

  # A hard exit path the @fresh-machine story does not cover: on a machine
  # without curl the installer cannot fetch its toolchain, so it must refuse at
  # its very first check and say what to install. ONE Gherkin sentence = ONE card
  # = ONE pixel baseline, asserted inside the step (tolerance: 0); the verdict
  # card twins its <pre> frame with an exit-code + message assert. Pure container
  # + installer, no GitLab and no network — it stops before any download.
  Scenario: without curl the installer stops and says what to install
    # Chapter: The installer refuses without curl
    # Note: A barren Ubuntu machine with no curl. The installer needs curl to download its toolchain, so this is the first thing it checks.
    # Copy: command -v curl || echo "curl: command not found"
    Given a fresh machine without curl, with the installer ready to run
    # Note: The developer launches the installer the usual way. It prints its banner and starts its checks.
    # Copy: bash install.sh
    When the installer runs on that machine
    # Note: The installer stops at the very first check, names the missing tool, and tells the developer to install curl and rerun. It exits with an error, before touching anything.
    # Copy: echo $?  # 1
    Then the installer stops and says curl must be installed first
