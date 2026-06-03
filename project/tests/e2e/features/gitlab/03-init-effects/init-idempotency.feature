@e2e @e2e-init-idempotency
Feature: task devsecops:init is idempotent
  As a maintainer
  I want re-running `task devsecops:init` to produce the same state
  So that there is no hidden token rotation or variable drift on every CI run.

  @e2e-init-idempotency-default
  Scenario: Re-running init leaves token id and CI/CD variable unchanged
    Given a GitLab runs in a container configured with user "lambda"
    And a test repository "e2e-init-idempotency" is created in GitLab
    When I run the command "task devsecops:init" for project "e2e-init-idempotency" with local authentication
    And the active token id of "TASK_COMMITIZEN_TOKEN" is captured for project "e2e-init-idempotency"
    And the CI/CD variable "TASK_COMMITIZEN_TOKEN" value is saved for project "e2e-init-idempotency"
    And I re-run "task devsecops:init" for project "e2e-init-idempotency"
    Then the active token id of "TASK_COMMITIZEN_TOKEN" must be unchanged for project "e2e-init-idempotency"
    And the CI/CD variable "TASK_COMMITIZEN_TOKEN" must not have changed for project "e2e-init-idempotency"
    And only one active token named "TASK_COMMITIZEN_TOKEN" must exist for "e2e-init-idempotency"
    When the devsecops:init output is displayed in the browser
    Then the devsecops:init terminal output should visually match "gitlab/03-init-effects/init-idempotency-terminal"
