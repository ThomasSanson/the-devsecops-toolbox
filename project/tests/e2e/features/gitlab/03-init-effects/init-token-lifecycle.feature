@e2e @e2e-token-lifecycle
Feature: devsecops:init heals token drift
  As a maintainer
  I want `task devsecops:init` to recover from external token damage
  (revocation, variable tampering, duplicates)
  So that one re-run always restores a single working token

  @e2e-token-lifecycle-revoked
  Scenario: a revoked token is recreated on the next init
    Given a GitLab runs in a container configured with user "lambda"
    And a test repository "e2e-token-revoked" is created in GitLab
    When I run the command "task devsecops:init" for project "e2e-token-revoked" with local authentication
    And the active token id of "TASK_COMMITIZEN_TOKEN" is captured for project "e2e-token-revoked"
    And the project access token "TASK_COMMITIZEN_TOKEN" is revoked externally for project "e2e-token-revoked"
    And I re-run "task devsecops:init" for project "e2e-token-revoked"
    Then the active token id of "TASK_COMMITIZEN_TOKEN" must differ from the captured id for project "e2e-token-revoked"
    And only one active token named "TASK_COMMITIZEN_TOKEN" must exist for "e2e-token-revoked"
    And the CI/CD variable "TASK_COMMITIZEN_TOKEN" must exist for project "e2e-token-revoked"
    When the devsecops:init output is displayed in the browser
    Then the devsecops:init terminal output should visually match "gitlab/03-init-effects/token-revoked-terminal"

  @e2e-token-lifecycle-tampered
  Scenario: a tampered CI/CD variable is repaired on the next init
    Given a GitLab runs in a container configured with user "lambda"
    And a test repository "e2e-token-tampered" is created in GitLab
    When I run the command "task devsecops:init" for project "e2e-token-tampered" with local authentication
    And the CI/CD variable "TASK_COMMITIZEN_TOKEN" is tampered for project "e2e-token-tampered"
    And I re-run "task devsecops:init" for project "e2e-token-tampered"
    Then the CI/CD variable "TASK_COMMITIZEN_TOKEN" for project "e2e-token-tampered" must not have value "tampered-by-e2e"
    And I can git clone the project "e2e-token-tampered" using the "TASK_COMMITIZEN_TOKEN" token
    When the devsecops:init output is displayed in the browser
    Then the devsecops:init terminal output should visually match "gitlab/03-init-effects/token-tampered-terminal"

  @e2e-token-lifecycle-duplicate
  Scenario: duplicate tokens are purged keeping a single active one
    Given a GitLab runs in a container configured with user "lambda"
    And a test repository "e2e-token-duplicate" is created in GitLab
    When I run the command "task devsecops:init" for project "e2e-token-duplicate" with local authentication
    And a duplicate project access token "TASK_COMMITIZEN_TOKEN" is created for project "e2e-token-duplicate"
    And I re-run "task devsecops:init" for project "e2e-token-duplicate"
    Then only one active token named "TASK_COMMITIZEN_TOKEN" must exist for "e2e-token-duplicate"
    And I can git clone the project "e2e-token-duplicate" using the "TASK_COMMITIZEN_TOKEN" token
    When the devsecops:init output is displayed in the browser
    Then the devsecops:init terminal output should visually match "gitlab/03-init-effects/token-duplicate-terminal"
