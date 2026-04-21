@bootstrap @devsecops @bootstrap-devsecops-installer
Feature: DevSecOps Toolbox Installer — completes with a linked GitLab project
  In order to trust the installer from a fresh machine
  As a developer
  I want the installer to complete cleanly when the repository is linked to GitLab

  @ubuntu @docker @bootstrap-devsecops-installer-gitlab-linked-success
  Scenario: Fresh Ubuntu can complete the installer with a linked GitLab project
    Given the GitLab test stack is started with docker compose
    And a fresh Ubuntu docker container is running on the GitLab test network
    And the local file ".config/devsecops/install.sh" is copied into the container at "/tmp/install.sh"
    And the packages "git curl unzip" are installed in the container
    And a git repository is initialized at "/workspace/my-project" in the container
    And a GitLab remote project "bootstrap-installer-linked-success" is configured for "/workspace/my-project" in the container
    When I run the install script with default answers from "/workspace/my-project" in the container
    Then the command should exit with code 0
    And the command output should contain "Installation complete!"
    And the command output is displayed in the browser
    Then the terminal output should visually match "fresh-ubuntu-install-script-gitlab-linked-success"
