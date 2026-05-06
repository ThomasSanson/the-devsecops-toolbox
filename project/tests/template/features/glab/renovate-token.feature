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
  Scenario: Shared project token manager uses glab api instead of curl with exposed token
    Given a clean temporary directory for "glab/renovate-token" tests
    When the copier command is executed with default settings
    Then the file ".config/glab/project-token.sh" should contain "glab api"
    And the file ".config/glab/project-token.sh" should NOT contain "PRIVATE-TOKEN"

  @no-token-in-variable
  Scenario: Renovate token script does not capture token in a shell variable
    Given a clean temporary directory for "glab/renovate-token" tests
    When the copier command is executed with default settings
    Then the file ".config/glab/renovate-token.sh" should NOT contain "TOKEN=$("

  @shared-manager
  Scenario: Renovate and Commitizen wrappers use a shared project token manager
    Given a clean temporary directory for "glab/renovate-token" tests
    When the copier command is executed with default settings
    Then the file ".config/glab/project-token.sh" should exist
    And the file ".config/glab/project-token.sh" should contain "glab api"
    And the file ".config/glab/renovate-token.sh" should contain "project-token.sh"
    And the file ".config/glab/commitizen-token.sh" should contain "project-token.sh"

  @expiry-within-gitlab-limit
  Scenario: Project token expiry stays within GitLab's max allowed lifetime
    # GitLab.com rejects Project Access Tokens whose expiry is >= today + 365 days
    # (HTTP 400 "Expiration date must be before <today+364>"). This test runs the
    # real EXPIRES_AT computation from the generated script and asserts the
    # resulting date is strictly inside GitLab's allowed window — independent
    # of whether the script uses "+90d", "+11 months" or any other syntax.
    Given a clean temporary directory for "glab/renovate-token" tests
    When the copier command is executed with default settings
    And the EXPIRES_AT block from "project-token.sh" is evaluated
    Then the resulting expiry date is strictly before today plus 365 days
