@copier @scaffolding @glab @renovate-token
Feature: Glab Renovate Token Task
  As a DevSecOps engineer
  I want a task to manage a Renovate Project Access Token
  So that Renovate can authenticate to GitLab with proper permissions

  @default
  Scenario: Glab Taskfile includes renovate-token task
    Given a clean temporary directory for "glab/renovate-token" tests
    When the copier command is executed with default settings
    Then the file ".config/glab/Taskfile.yml" should contain "renovate-token:"
    And the file ".config/glab/Taskfile.yml" should contain "desc:"

  @access-level
  Scenario: Renovate token task enforces Maintainer access level
    Given a clean temporary directory for "glab/renovate-token" tests
    When the copier command is executed with default settings
    Then the file ".config/glab/Taskfile.yml" should contain "access_level=40"

  @variables
  Scenario: Renovate token task uses configurable variables
    Given a clean temporary directory for "glab/renovate-token" tests
    When the copier command is executed with default settings
    Then the file ".config/glab/Taskfile.yml" should contain "TASK_GLAB_RENOVATE_TOKEN_NAME"
    And the file ".config/glab/Taskfile.yml" should contain "TASK_GLAB_RENOVATE_TOKEN_PROTECTED"

  @preconditions
  Scenario: Renovate token task requires glab and jq
    Given a clean temporary directory for "glab/renovate-token" tests
    When the copier command is executed with default settings
    Then the file ".config/glab/Taskfile.yml" should contain "command -v glab"
    And the file ".config/glab/Taskfile.yml" should contain "command -v jq"
    And the file ".config/glab/Taskfile.yml" should contain "glab auth status"

  @no-token-leak
  Scenario: Renovate token validation uses glab api instead of curl with exposed token
    Given a clean temporary directory for "glab/renovate-token" tests
    When the copier command is executed with default settings
    Then the file ".config/glab/renovate-token.sh" should contain "glab api"
    And the file ".config/glab/renovate-token.sh" should NOT contain "PRIVATE-TOKEN"

  @no-token-in-variable
  Scenario: Renovate token script does not capture token in a shell variable
    Given a clean temporary directory for "glab/renovate-token" tests
    When the copier command is executed with default settings
    Then the file ".config/glab/renovate-token.sh" should NOT contain "TOKEN=$("
