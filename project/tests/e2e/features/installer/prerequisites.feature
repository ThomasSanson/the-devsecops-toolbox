@e2e @e2e-installer-prereqs
Feature: Installer auto-installs missing prerequisites on a bare machine
  In order to trust the installer from a fresh machine
  As a developer
  I want the installer to auto-install missing prerequisites (unzip) with sudo
  And to fail cleanly with actionable guidance when no GitLab remote exists

  @e2e-installer-prereqs-bare-ubuntu
  Scenario: A bare Ubuntu with only sudo and curl auto-installs prerequisites then fails without Git linkage
    Given a bare Ubuntu container with only sudo and curl
    And the working-branch installer is staged in the bare container
    When I run the installer non-interactively in the bare container
    Then the bare-container installer run should fail
    And the bare-container installer output should contain "DevSecOps Toolbox Installer"
    And the bare-container installer output should contain "task devsecops:init failed. Attempting to install missing prerequisites..."
    And the bare-container installer output should contain "Installing unzip with sudo..."
    And the bare-container installer output should contain "No 'origin' remote configured. Add a GitLab remote, then re-run."
    And the bare-container installer guidance should visually match "installer/prerequisites-failure"
