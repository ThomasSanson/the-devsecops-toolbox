@e2e @e2e-renovate-token-clone
Feature: The Renovate token created by task devsecops:init is usable for git clone
  As a project maintainer
  I want the TASK_RENOVATE_TOKEN written into the CI/CD variables to actually
  authenticate against the GitLab instance
  So that the Renovate bot can clone the repo on schedule.

  @e2e-renovate-token-clone-default
  Scenario: A fresh project's Renovate token can clone the repo via HTTPS
    Given a GitLab runs in a container configured with user "lambda"
    And a test repository "e2e-renovate-token-clone" is created in GitLab
    When I run the command "task devsecops:init" for project "e2e-renovate-token-clone" with local authentication
    Then a project access token "TASK_RENOVATE_TOKEN" must exist with Maintainer role for "e2e-renovate-token-clone"
    And the CI/CD variable "TASK_RENOVATE_TOKEN" must exist for project "e2e-renovate-token-clone"
    And I can git clone the project "e2e-renovate-token-clone" using the "TASK_RENOVATE_TOKEN" token
    When the devsecops:init output is displayed in the browser
    Then the devsecops:init terminal output should visually match "gitlab/03-init-effects/renovate-token-clone-terminal"
