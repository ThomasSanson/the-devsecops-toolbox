@gitlab-default-branch @gitlab
Feature: GitLab Default Branch Configuration
  As a project maintainer
  I want to configure the default branch to main
  In order to follow the project conventions

  Scenario: Configure default branch to main via API
    Given a lambda user with a fresh project "default-branch-test"
    When the default branch is set to "main" for "default-branch-test"
    Then the repository settings show "main" as the default branch for "default-branch-test"

  @gitlab-default-branch-idempotent
  Scenario: Re-running default branch configuration is idempotent
    Given the user "lambda" is logged in to GitLab
    When the default branch is set to "main" for "default-branch-test"
    Then the repository settings show "main" as the default branch for "default-branch-test"
