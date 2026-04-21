@bootstrap @devsecops @bootstrap-devsecops-installer
Feature: DevSecOps Toolbox Installer — run from a local file on fresh Ubuntu
  In order to trust the installer from a fresh machine
  As a developer
  I want the install script to run from a local file in a clean Ubuntu container

  @ubuntu @docker
  Scenario: Fresh Ubuntu can run the install script from a local file
    Given a fresh Ubuntu docker container is running
    And the local file ".config/devsecops/install.sh" is copied into the container at "/tmp/install.sh"
    And the packages "git curl" are installed in the container
    And a git repository is initialized at "/workspace/my-project" in the container
    When I run the install script with default answers from "/workspace/my-project" in the container
    Then the command output should contain "🚀 DevSecOps Toolbox Installer"
    And the command output should contain "Installing toolchain"
    And the command output is displayed in the browser
    Then the terminal output should visually match "fresh-ubuntu-install-script"
