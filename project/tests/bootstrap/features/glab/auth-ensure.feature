Feature: GitLab Auth Ensure DX

  As a developer initializing the DevSecOps Toolbox
  I want a premium terminal UI when GitLab authentication is missing
  So that I am guided gracefully to authenticate

  @bootstrap-glab-auth-ensure
  Scenario: Missing glab binary shows premium error when UI tools are ready
    Given a generated toolbox project is mounted in a fresh Ubuntu ttyd container
    When I run "task gum:install && task glow:install" from "/workspace" in the ttyd container
    And I open the web terminal
    And I type "task glab:auth:ensure" in the terminal and wait for completion
    Then the terminal output should visually match "glab-auth-ensure-missing-bin"

  @bootstrap-glab-auth-ensure
  Scenario: CI mode shows premium error when glab is not authenticated
    Given a generated toolbox project is mounted in a fresh Ubuntu ttyd container
    When I run "task gum:install && task glow:install && task glab:install" from "/workspace" in the ttyd container
    And I open the web terminal
    And I type "CI=true task glab:auth:ensure" in the terminal and wait for completion
    Then the terminal output should visually match "glab-auth-ensure-ci-missing-bin"

  @bootstrap-glab-auth-ensure-present
  Scenario: Auth ensure shows premium UI when prerequisites are met
    Given a generated toolbox project is mounted in a fresh Ubuntu ttyd container
    When I run "task dev:setup-environment" from "/workspace" in the ttyd container
    And I open the web terminal
    And I type "task glab:auth:ensure" in the terminal
    Then the terminal output should visually match "glab-auth-ensure-premium-ui"
