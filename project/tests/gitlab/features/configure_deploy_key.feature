@gitlab-deploy-key @gitlab
Feature: GitLab Deploy Key Configuration
  As a project maintainer
  I want to create an SSH deploy key for Commitizen
  In order to allow automated git operations during releases

  @gitlab-deploy-key-create
  Scenario: The devsecops:init command creates a deploy key and stores the private key as CI/CD variable
    Given a GitLab runs in a container configured with user "lambda"
    And a test repository "deploy-key-test" is created in GitLab
    When I run the deploy key setup for project "deploy-key-test" with local authentication
    Then a deploy key "Commitizen Deploy Key" must exist with write access for "deploy-key-test"
    And the CI/CD variable "CZ_DEPLOY_KEY" must exist as file type for "deploy-key-test"
    And the CI/CD variable "CZ_DEPLOY_KEY" value must end with a trailing newline for "deploy-key-test"
    And the branch "main" is protected with merge for maintainers and push for no one for "deploy-key-test"

  @gitlab-deploy-key-idempotent
  Scenario: Re-running devsecops:init keeps existing deploy key when key pair is in sync
    Given the user "lambda" is logged in to GitLab
    And the CI/CD variable "CZ_DEPLOY_KEY" value is saved for project "deploy-key-test"
    When I re-run the deploy key setup for project "deploy-key-test"
    Then the CI/CD variable "CZ_DEPLOY_KEY" must not have changed for project "deploy-key-test"
    And a deploy key "Commitizen Deploy Key" must exist with write access for "deploy-key-test"
    And the deploy key "Commitizen Deploy Key" must be in sync with variable "CZ_DEPLOY_KEY" for "deploy-key-test"

  @gitlab-deploy-key-resync
  Scenario: Deploy key is regenerated when CI/CD variable is tampered
    Given a GitLab runs in a container configured with user "lambda"
    And a test repository "deploy-key-test" is created in GitLab
    When I run the deploy key setup for project "deploy-key-test" with local authentication
    And the deploy key variable "CZ_DEPLOY_KEY" is tampered with for project "deploy-key-test"
    And I re-run the deploy key setup for project "deploy-key-test"
    Then a deploy key "Commitizen Deploy Key" must exist with write access for "deploy-key-test"
    And the deploy key "Commitizen Deploy Key" must be in sync with variable "CZ_DEPLOY_KEY" for "deploy-key-test"
