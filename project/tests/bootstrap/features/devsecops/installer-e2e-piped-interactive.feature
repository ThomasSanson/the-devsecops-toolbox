@bootstrap @devsecops @bootstrap-devsecops-installer
Feature: DevSecOps Toolbox Installer — piped invocation remains interactive with a TTY
  In order to trust the installer from a fresh machine
  As a developer
  I want the piped install workflow to stay interactive when a TTY is available

  @ubuntu @docker @bootstrap-devsecops-installer-piped-interactive-success-e2e
  Scenario: Piped installer remains interactive when a TTY is available
    Given the GitLab test stack is started with docker compose
    And a fresh Ubuntu docker container is running on the GitLab test network
    And the local file ".config/devsecops/install.sh" is copied into the container at "/tmp/install.sh"
    And the packages "git curl unzip" are installed in the container
    And a git repository is initialized at "/workspace/my-project" in the container
    And a GitLab remote project "bootstrap-installer-piped-interactive" is configured for "/workspace/my-project" in the container
    When I run "cat /tmp/install.sh | bash" from "/workspace/my-project" in the container via pseudo-tty with 40 default answers
    Then the command should exit with code 0
    And the command output should contain "Which CI/CD platform are you using?"
    And the command output should contain "Installation complete!"
    And the command output is displayed in the browser
    Then the terminal output should visually match "fresh-ubuntu-install-script-piped-interactive-success"
