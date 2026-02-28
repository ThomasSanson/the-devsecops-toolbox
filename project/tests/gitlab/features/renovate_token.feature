@gitlab-renovate-token @gitlab
Feature: GitLab Renovate Project Access Token
  As a project maintainer
  I want to create a project access token for Renovate with Maintainer role
  In order to allow Renovate to manage dependencies automatically

  @gitlab-renovate-token-create
  Scenario: The devsecops:renovate-token command creates and configures the token in GitLab
    Given a GitLab runs in a container configured with user "lambda"
    And a test repository "renovate-token-test" is created in GitLab
    When I run the command "task devsecops:init" for project "renovate-token-test" with local authentication
    Then a Renovate token "TASK_RENOVATE_TOKEN" must exist with Maintainer role for "renovate-token-test"
    And the token must be present in the project CI/CD variables for "renovate-token-test"
    And I can clone the repository from the GitLab container

  @gitlab-renovate-token-recreate-after-revoke
  Scenario: Re-running devsecops:init recreates the token when it has been revoked
    Given the user "lambda" is logged in to GitLab
    When the Renovate access token "TASK_RENOVATE_TOKEN" is revoked from project "renovate-token-test"
    And I re-run "task devsecops:init" for project "renovate-token-test"
    Then a Renovate token "TASK_RENOVATE_TOKEN" must exist with Maintainer role for "renovate-token-test"
    And the token must be present in the project CI/CD variables for "renovate-token-test"
    And I can clone the repository from the GitLab container

  @gitlab-renovate-token-resync-on-mismatch
  Scenario: Re-running devsecops:init regenerates when CI/CD variable is out of sync with the token
    Given a GitLab runs in a container configured with user "lambda"
    And a test repository "renovate-token-test" is created in GitLab
    When I run the command "task devsecops:init" for project "renovate-token-test" with local authentication
    And the CI/CD variable "TASK_RENOVATE_TOKEN" is tampered with for project "renovate-token-test"
    And I re-run "task devsecops:init" for project "renovate-token-test"
    Then a Renovate token "TASK_RENOVATE_TOKEN" must exist with Maintainer role for "renovate-token-test"
    And the token must be present in the project CI/CD variables for "renovate-token-test"
    And the CI/CD variable "TASK_RENOVATE_TOKEN" must hold a valid token for project "renovate-token-test"
