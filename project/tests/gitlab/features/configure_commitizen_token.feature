@gitlab-commitizen-token @gitlab
Feature: GitLab Commitizen Project Access Token
  As a project maintainer
  I want to create a project access token for Commitizen with Maintainer role
  In order to allow secure HTTPS release pushes and branch protection API updates

  @gitlab-commitizen-token-create
  Scenario: The devsecops:init command creates and configures the Commitizen token
    Given a GitLab runs in a container configured with user "lambda"
    And a test repository "commitizen-token-test" is created in GitLab
    When I run the command "task devsecops:init" for project "commitizen-token-test" with local authentication
    Then a Commitizen token "TASK_COMMITIZEN_TOKEN" must exist with Maintainer role for "commitizen-token-test"
    And the Commitizen token must be present in the project CI/CD variables for "commitizen-token-test"
    And the branch "main" is protected with merge for maintainers and push for no one for "commitizen-token-test"

  @gitlab-commitizen-token-recreate-after-revoke
  Scenario: Re-running devsecops:init recreates the token when it has been revoked
    Given the user "lambda" is logged in to GitLab
    When the Commitizen access token "TASK_COMMITIZEN_TOKEN" is revoked from project "commitizen-token-test"
    And I re-run "task devsecops:init" for project "commitizen-token-test"
    Then a Commitizen token "TASK_COMMITIZEN_TOKEN" must exist with Maintainer role for "commitizen-token-test"
    And the Commitizen token must be present in the project CI/CD variables for "commitizen-token-test"

  @gitlab-commitizen-token-idempotent
  Scenario: Re-running devsecops:init is idempotent when token and variable are already in sync
    Given the user "lambda" is logged in to GitLab
    And the CI/CD variable "TASK_COMMITIZEN_TOKEN" value is saved for project "commitizen-token-test"
    When I re-run "task devsecops:init" for project "commitizen-token-test"
    Then the CI/CD variable "TASK_COMMITIZEN_TOKEN" must not have changed for project "commitizen-token-test"
    And a Commitizen token "TASK_COMMITIZEN_TOKEN" must exist with Maintainer role for "commitizen-token-test"
    And the Commitizen token must be present in the project CI/CD variables for "commitizen-token-test"

  @gitlab-commitizen-token-resync-on-mismatch
  Scenario: Re-running devsecops:init regenerates when CI/CD variable is out of sync with the token
    Given a GitLab runs in a container configured with user "lambda"
    And a test repository "commitizen-token-test" is created in GitLab
    When I run the command "task devsecops:init" for project "commitizen-token-test" with local authentication
    And the CI/CD variable "TASK_COMMITIZEN_TOKEN" is tampered with for project "commitizen-token-test"
    And I re-run "task devsecops:init" for project "commitizen-token-test"
    Then a Commitizen token "TASK_COMMITIZEN_TOKEN" must exist with Maintainer role for "commitizen-token-test"
    And the Commitizen token must be present in the project CI/CD variables for "commitizen-token-test"
    And the CI/CD variable "TASK_COMMITIZEN_TOKEN" must hold a valid token for project "commitizen-token-test"

  @gitlab-commitizen-token-deduplicate
  Scenario: Re-running devsecops:init purges duplicate tokens keeping only the newest
    Given the user "lambda" is logged in to GitLab
    And a duplicate Commitizen token "TASK_COMMITIZEN_TOKEN" is created for project "commitizen-token-test"
    When I re-run "task devsecops:init" for project "commitizen-token-test"
    Then a Commitizen token "TASK_COMMITIZEN_TOKEN" must exist with Maintainer role for "commitizen-token-test"
    And the Commitizen token must be present in the project CI/CD variables for "commitizen-token-test"
    And only one active Commitizen token named "TASK_COMMITIZEN_TOKEN" must exist for "commitizen-token-test"
