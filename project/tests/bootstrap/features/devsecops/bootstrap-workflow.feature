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
