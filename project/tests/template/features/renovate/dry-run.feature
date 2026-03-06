@copier @renovate @dry-run
Feature: Renovate dry-run processes version updates correctly
  As a DevSecOps engineer
  I want Renovate to handle version prefix stripping in custom managers
  So that automated dependency updates do not fail with version mismatch

  @renovate-glab-dry-run
  Scenario: Renovate dry-run updates glab version without v-prefix mismatch
    Given a generated project for "renovate/dry-run" tests
    And a git repository initialized in the generated project
    When I run a Renovate dry-run on the generated project
    Then the Renovate output should not contain a v-prefixed newValue
