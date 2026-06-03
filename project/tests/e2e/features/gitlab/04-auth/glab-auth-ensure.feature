@e2e @e2e-glab-auth-ensure
Feature: task glab:auth:ensure guides users when glab is not ready
  As a developer onboarding the toolbox
  I want `task glab:auth:ensure` to fail fast with actionable guidance
  When the glab binary is missing OR authentication is not configured
  So that I know exactly which command to run next.

  @e2e-glab-auth-ensure-missing-bin
  Scenario: ensure fails with install guidance when the glab binary is missing
    Given the fresh Ubuntu environment has "gum" and "glow" installed
    When I run the command "task glab:auth:ensure" in the fresh Ubuntu environment
    Then the captured command should exit with a non-zero code
    And the captured output should contain "glab"
    When the captured output is displayed in the browser
    Then the captured output should visually match "gitlab/04-auth/glab-auth-ensure-missing-bin-terminal"

  @e2e-glab-auth-ensure-ci-mode
  Scenario: ensure fails in CI mode when glab is installed but not authenticated
    Given the fresh Ubuntu environment has "gum", "glow" and "glab" installed
    When I run the command "CI=true task glab:auth:ensure" in the fresh Ubuntu environment
    Then the captured command should exit with a non-zero code
    And the captured output should contain "GitLab authentication required"
    And the captured output should contain "task glab:auth"
    When the captured output is displayed in the browser
    Then the captured output should visually match "gitlab/04-auth/glab-auth-ensure-ci-mode-terminal"
