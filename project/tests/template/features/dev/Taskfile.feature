@dev-taskfile @scaffolding @taskfile
Feature: Dev Taskfile Standardization
  As a DevSecOps engineer
  I want a standard Taskfile for Dev operations
  So that I can use consistent commands and documentation

  @default
  Scenario: Verify Dev Taskfile documentation
    Given a clean temporary directory for "dev/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/dev/Taskfile.yml" should exist
    And the file ".config/dev/Taskfile.yml" should contain "desc: 🚀 Run all CI/CD initialization steps (CI-only)"
    And the file ".config/dev/Taskfile.yml" should contain "desc: ⚙️ Configure the development environment"

  @glab-install
  Scenario: Verify glab is installed during setup-environment
    Given a clean temporary directory for "dev/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/dev/Taskfile.yml" should contain ".config/glab/install.sh"

  @jq-install
  Scenario: Verify jq is installed during setup-environment
    Given a clean temporary directory for "dev/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/dev/Taskfile.yml" should contain ".config/jq/install.sh"

  @lefthook-integration
  Scenario: Verify lefthook is integrated into setup-environment
    Given a clean temporary directory for "dev/taskfile" tests
    When the copier command is executed with default settings
    Then the task "setup-environment" in file ".config/dev/Taskfile.yml" should contain "- task: lefthook"

  @commitizen-token
  Scenario: Verify setup-ssh no longer depends on deploy-key file variables
    Given a clean temporary directory for "dev/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/dev/Taskfile.yml" should NOT contain "TASK_DEV_INIT_DEPLOY_KEY_PATH"
    And the file ".config/dev/Taskfile.yml" should NOT contain "~/.ssh/id_rsa"
