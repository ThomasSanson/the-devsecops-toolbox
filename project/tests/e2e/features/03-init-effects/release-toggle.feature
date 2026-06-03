@e2e @e2e-release-toggle
Feature: task release toggles the push protection window
  As a project maintainer
  I want `task release` to temporarily open push on main and ALWAYS close it back
  Even when the release push itself fails
  So that main stays locked outside of the release window.

  @e2e-release-toggle-success
  Scenario: task release restores branch push access to "no one" after a successful release
    Given a GitLab runs in a container configured with user "lambda"
    And a test repository "e2e-release-toggle" is created in GitLab
    When I run "task devsecops:init" and then "task release" for project "e2e-release-toggle" with local authentication
    Then the release logs should contain "Temporarily opening push access for Maintainers"
    And the release logs should contain "Restoring branch protection (push=No one)"
    And the branch "main" must be protected with merge for maintainers and push for no one for "e2e-release-toggle"
    When the release logs are displayed in the browser
    Then the release logs should visually match "e2e_release_toggle_success_terminal"

  @e2e-release-toggle-failure
  Scenario: task release restores branch push access to "no one" when push fails (safety net)
    Given a GitLab runs in a container configured with user "lambda"
    And a test repository "e2e-release-toggle-failure" is created in GitLab
    When I run "task devsecops:init" and then "task release" with a failing push for project "e2e-release-toggle-failure"
    Then the release command should fail
    And the release logs should contain "Temporarily opening push access for Maintainers"
    And the release logs should contain "Restoring branch protection (push=No one)"
    And the branch "main" must be protected with merge for maintainers and push for no one for "e2e-release-toggle-failure"
    When the release logs are displayed in the browser
    Then the release logs should visually match "e2e_release_toggle_failure_terminal"
