@e2e @e2e-init-baseline
Feature: DevSecOps init configures a fresh GitLab project (default baseline)
  As a maintainer onboarding the toolbox
  I want `task devsecops:init` to set up the project access token, the CI/CD
  variable and the branch protection on a fresh GitLab project
  In order to validate end-to-end with both terminal and GitLab visual proofs.

  @e2e-init-baseline-default
  Scenario: task devsecops:init configures the default baseline project
    Given a GitLab runs in a container configured with user "lambda"
    And a test repository "init-baseline" is created in GitLab
    When I run the command "task devsecops:init" for project "init-baseline" with local authentication
    And the devsecops:init output is displayed in the browser
    Then the devsecops:init terminal output should visually match "gitlab/03-init-effects/init-baseline-terminal"
    And a project access token "TASK_COMMITIZEN_TOKEN" must exist with Maintainer role for "init-baseline"
    And the GitLab access tokens page for "init-baseline" should visually match "gitlab/03-init-effects/init-baseline-access-tokens"
    And the CI/CD variable "TASK_COMMITIZEN_TOKEN" must exist for project "init-baseline"
    And the GitLab CI/CD variables page for "init-baseline" should visually match "gitlab/03-init-effects/init-baseline-cicd-variables"
    And the branch "main" must be protected with merge for maintainers and push for no one for "init-baseline"
