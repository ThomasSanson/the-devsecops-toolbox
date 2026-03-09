@copier @task @task-install-sudo @install-scripts
Feature: Taskfile install script handles version pinning and permissions
  As a DevSecOps engineer
  I want the Taskfile install script to enforce the pinned version
  So that CI pipelines always use the correct Taskfile version even when a different version is pre-installed

  @timeout(600000)
  Scenario: Install script upgrades task to pinned version in the CI image
    Given a "registry.gitlab.com/digital-commons/devsecops/the-devsecops-toolbox:21.3.2" container is running
    When I run ".config/task/install.sh" in the container
    Then the command should exit with code 0
    And "task --version" should succeed in the container
