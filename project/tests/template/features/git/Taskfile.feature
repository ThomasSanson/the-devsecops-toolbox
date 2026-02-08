@copier @scaffolding @git
Feature: Git Taskfile Standardization
  As a DevSecOps engineer
  I want a standard Taskfile for Git operations
  So that I can use consistent commands and documentation

  @default
  Scenario: Verify Git Taskfile structure and documentation
    Given a clean temporary directory for "git/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/git/Taskfile.yml" should exist
    And the file ".config/git/Taskfile.yml" should contain "TASK_GIT_CONFIG_DIR"
    And the file ".config/git/Taskfile.yml" should contain "install:"
    And the file ".config/git/Taskfile.yml" should contain "summary: |"
    And the file ".config/git/Taskfile.yml" should contain "Installs Git on the system"
