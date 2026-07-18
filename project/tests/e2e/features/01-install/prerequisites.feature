@e2e @e2e-installer-prereqs
Feature: The installer sets up the tools it needs on a fresh machine
  In order to trust the installer on a brand-new machine
  As a developer
  I want the installer to add the tools it is missing (like unzip) by itself
  And to stop with a clear next step when the project is not linked to GitLab yet

  # ONE storyboard: a fresh machine from a cold start, as one journey — almost
  # no tools installed, the installer starts, it adds the one tool it needs
  # (unzip) with sudo, then stops with the ONE piece of guidance that actually
  # unblocks a developer: link the project to GitLab. ONE Gherkin sentence =
  # ONE storyboard card = ONE pixel baseline (tolerance: 0); each result card
  # twins its <pre> frame with a check on the same fact in the log.
  @e2e-bare-machine-start
  Scenario: A fresh machine with only sudo and curl adds its missing tool, then stops because the project is not linked to GitLab
    Given a fresh machine has only sudo and curl, with the installer ready to run
    When the installer runs on the fresh machine with no one to answer its questions
    Then the installer installs the tool it was missing and tries again
    Then the installer stops and explains how to link the project to GitLab
