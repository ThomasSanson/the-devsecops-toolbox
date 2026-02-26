@glab-taskfile @scaffolding @taskfile
Feature: Glab Taskfile Standardization
  As a DevSecOps engineer
  I want a standard Taskfile for Glab operations
  So that I can use consistent commands and documentation

  @default
  Scenario: Verify Glab Taskfile documentation
    Given a clean temporary directory for "glab/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/glab/Taskfile.yml" should exist
    And the file ".config/glab/Taskfile.yml" should contain "desc: 📦 Install glab (GitLab CLI)"
    And the file ".config/glab/Taskfile.yml" should contain "desc: 🔄 Update glab to latest version"
    And the file ".config/glab/Taskfile.yml" should contain "desc: 🔐 Authenticate with GitLab"

  @gitlab-merge-method
  Scenario: Glab Taskfile includes merge-method task
    Given a clean temporary directory for "glab/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/glab/Taskfile.yml" should contain "desc: 🦊 Configure GitLab merge method to fast-forward"

  @merge-method-error-message
  Scenario: Merge-method task provides actionable error message on failure
    Given a clean temporary directory for "glab/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/glab/Taskfile.yml" should contain "A user with Maintainer (or higher) role must run locally:"
    And the file ".config/glab/Taskfile.yml" should contain "task devsecops:init"
