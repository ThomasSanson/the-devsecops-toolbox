@bootstrap @devsecops @bootstrap-devsecops-installer
Feature: DevSecOps Toolbox Installer
  In order to easily set up a DevSecOps project from scratch
  As a developer on a fresh machine
  I want a standalone installer that sets up the toolchain and scaffolds the project

  @ubuntu @ttyd
  Scenario: Generated README documents the installer workflow
    Given a generated toolbox project is mounted in a fresh Ubuntu ttyd container
    And the repository file "README.md" is copied into the ttyd container
    When I open the web terminal
    And I type "cat README.md" in the terminal and wait for completion
    Then the terminal output should visually match "devsecops-readme"

  @ubuntu @ttyd
  Scenario: Installer script has correct structure and pinned versions
    Given a generated toolbox project is mounted in a fresh Ubuntu ttyd container
    When I open the web terminal
    And I type "cat .config/devsecops/install.sh" in the terminal and wait for completion
    Then the terminal output should visually match "devsecops-install-sh"

  @ubuntu @ttyd
  Scenario: Init Taskfile has prerequisites and configure tasks
    Given a generated toolbox project is mounted in a fresh Ubuntu ttyd container
    When I open the web terminal
    And I type "cat .config/devsecops/Taskfile.init.yml" in the terminal and wait for completion
    Then the terminal output should visually match "devsecops-taskfile-init"

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

  @ubuntu @docker @bootstrap-devsecops-installer-prerequisites-failure-e2e
  Scenario: Fresh Ubuntu end-to-end run auto-installs prerequisites then fails without Git linkage
    Given I set docker container name to "test-bootstrap-e2e"
    And I run host commands:
      """
      docker rm -f test-bootstrap-e2e >/dev/null 2>&1 || true
      docker run -d --name test-bootstrap-e2e ubuntu:24.04 bash -c "while :; do sleep 10 & wait; done"
      docker cp .config/devsecops/install.sh test-bootstrap-e2e:/tmp/install.sh
      docker exec test-bootstrap-e2e sh -c "apt-get update -qq && apt-get install -y -qq sudo curl"
      docker exec test-bootstrap-e2e sh -c "id bootstrap >/dev/null 2>&1 || useradd -m -s /bin/bash bootstrap"
      docker exec test-bootstrap-e2e sh -c "printf '%s\n' 'bootstrap ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/bootstrap && chmod 0440 /etc/sudoers.d/bootstrap && mkdir -p /workspace && chown -R bootstrap:bootstrap /workspace && chown bootstrap:bootstrap /tmp/install.sh"
      docker exec -u bootstrap test-bootstrap-e2e sh -c "id -un"
      """
    Then the command should exit with code 0
    And the command output should contain "bootstrap"
    When I run host commands:
      """
      docker exec -u bootstrap test-bootstrap-e2e sh -c "mkdir -p /workspace/my-project && cd /workspace/my-project && yes '' | head -n 40 | bash /tmp/install.sh"
      """
    Then the command output should contain "🚀 DevSecOps Toolbox Installer"
    And the command output should contain "task devsecops:init failed. Attempting to install missing prerequisites..."
    And the command output should contain "Installing unzip with sudo..."
    And the command output should contain "fatal: not a git repository"
    And the command should fail
    And the command output is displayed in the browser
    Then the terminal output should visually match "fresh-ubuntu-install-script-prerequisites-failure"

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
