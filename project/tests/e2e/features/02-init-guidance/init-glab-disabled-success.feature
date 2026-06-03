@e2e @e2e-init-guidance @e2e-init-guidance-disabled
Feature: DevSecOps init succeeds cleanly when GitLab integration is opted-out
  As a toolbox user who does not use GitLab
  I want `task devsecops:init` to complete without GitLab-specific output
  When TASK_GLAB_ENABLED=false
  So that I am not nagged about authentication I do not need.

  @e2e-init-guidance-disabled-success
  Scenario: init completes with exit 0 and no glab guidance when disabled
    Given a fresh Ubuntu environment with the toolbox is set up with packages "git unzip"
    When I run the command "TASK_GLAB_ENABLED=false task devsecops:init" in the fresh Ubuntu environment
    Then the captured command should exit with code 0
    And the captured output should contain "DevSecOps project initialization completed"
    And the captured output should contain 'task: Task "glab:install" is up to date'
    And the captured output should not contain "glab auth login"
    When the captured output is displayed in the browser
    Then the captured output should visually match "e2e_init_guidance_disabled_terminal"
