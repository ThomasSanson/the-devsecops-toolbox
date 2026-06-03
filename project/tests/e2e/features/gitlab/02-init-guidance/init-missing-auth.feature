@e2e @e2e-init-guidance @e2e-init-guidance-missing-auth
Feature: DevSecOps init guides users when GitLab auth is missing
  As a first-time toolbox user with a GitLab remote
  I want `task devsecops:init` to fail with actionable guidance
  When glab is not authenticated against that host
  So that I can recover and re-run.

  @e2e-init-guidance-missing-auth-default
  Scenario: init exits with a non-zero code and points at the missing glab auth
    Given a fresh Ubuntu environment with the toolbox is set up with git remote "https://gitlab.com/example/bootstrap-guidance.git"
    When I run the command "task devsecops:init" in the fresh Ubuntu environment
    Then the captured command should exit with a non-zero code
    And the captured output should contain "GitLab authentication required"
    And the captured output should contain "task glab:auth"
    And the captured output should not contain "DevSecOps project initialization completed"
    When the captured output is displayed in the browser
    Then the captured output should visually match "gitlab/02-init-guidance/missing-auth-terminal"
