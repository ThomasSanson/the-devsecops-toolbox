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

  @gitlab-merge-settings
  Scenario: Glab Taskfile includes merge-settings task with configurable variables
    Given a clean temporary directory for "glab/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/glab/Taskfile.yml" should contain "desc: 🦊 Configure GitLab merge request settings"
    And the file ".config/glab/Taskfile.yml" should contain "TASK_GLAB_MERGE_METHOD"
    And the file ".config/glab/Taskfile.yml" should contain "TASK_GLAB_SQUASH_OPTION"
    And the file ".config/glab/Taskfile.yml" should contain "TASK_GLAB_REMOVE_SOURCE_BRANCH"
    And the file ".config/glab/Taskfile.yml" should contain "TASK_GLAB_PIPELINE_MUST_SUCCEED"
    And the file ".config/glab/Taskfile.yml" should contain "TASK_GLAB_ALL_THREADS_RESOLVED"
    And the file ".config/glab/Taskfile.yml" should contain "TASK_GLAB_MR_LINK_ENABLED"

  @merge-settings-error-message
  Scenario: Merge-settings task provides actionable error message on failure
    Given a clean temporary directory for "glab/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/glab/Taskfile.yml" should contain "A user with Maintainer (or higher) role must run locally:"
    And the file ".config/glab/Taskfile.yml" should contain "task devsecops:init"

  @glab-auth-host-detection
  Scenario: Auth task auto-detects GitLab host from git remotes
    Given a clean temporary directory for "glab/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/glab/Taskfile.yml" should contain "glab auth login --hostname"
    And the file ".config/glab/Taskfile.yml" should contain "Detected GitLab host:"

  @glab-gitlabssh-normalization
  Scenario: Detect function normalizes gitlabssh hostnames to gitlab
    Given a clean temporary directory for "glab/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/glab/Taskfile.yml" should contain "gitlabssh.*"
