@gitlab-commitizen-release-toggle @gitlab
Feature: Commitizen release temporary push window on protected branch
  As a project maintainer
  I want task release to temporarily open push access and always close it back
  In order to keep main locked down outside of the release window

  @gitlab-commitizen-release-toggle-success
  Scenario: task release restores branch push access to no one after a successful release
    Given a GitLab runs in a container configured with user "lambda"
    And a test repository "commitizen-release-toggle-test" is created in GitLab
    When I run "task devsecops:init" and then "task release" for project "commitizen-release-toggle-test" with local authentication
    Then the release logs should contain "Temporarily opening push access for Maintainers"
    And the release logs should contain "Restoring branch protection (push=No one)"
    And the branch "main" is protected with merge for maintainers and push for no one for "commitizen-release-toggle-test"

  @gitlab-commitizen-release-toggle-failure
  Scenario: task release restores branch push access to no one when push fails
    Given a GitLab runs in a container configured with user "lambda"
    And a test repository "commitizen-release-toggle-failure-test" is created in GitLab
    When I run "task devsecops:init" and then "task release" with a failing push for project "commitizen-release-toggle-failure-test"
    Then the release command should fail
    And the release logs should contain "Temporarily opening push access for Maintainers"
    And the release logs should contain "Restoring branch protection (push=No one)"
    And the branch "main" is protected with merge for maintainers and push for no one for "commitizen-release-toggle-failure-test"
