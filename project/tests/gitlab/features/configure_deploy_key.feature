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
