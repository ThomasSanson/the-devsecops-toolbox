@e2e @e2e-init-token-resync
Feature: task devsecops:init re-syncs after an external token rotation
  As a project maintainer
  I want re-running `task devsecops:init` to detect that a token has been
  rotated externally (e.g. manually on GitLab) and to regenerate + re-store
  the CI/CD variable with a fresh valid token
  So that the next CI pipeline does not break on a stale credential.

  @e2e-init-token-resync-default
  Scenario: External token rotation triggers a re-sync on the next init
    Given a GitLab runs in a container configured with user "lambda"
    And a test repository "e2e-init-token-resync" is created in GitLab
    When I run the command "task devsecops:init" for project "e2e-init-token-resync" with local authentication
    And the active token id of "TASK_COMMITIZEN_TOKEN" is captured for project "e2e-init-token-resync"
    And the access token "TASK_COMMITIZEN_TOKEN" is rotated externally for project "e2e-init-token-resync"
    And I re-run "task devsecops:init" for project "e2e-init-token-resync"
    Then the active token id of "TASK_COMMITIZEN_TOKEN" must differ from the captured id for project "e2e-init-token-resync"
    And only one active token named "TASK_COMMITIZEN_TOKEN" must exist for "e2e-init-token-resync"
    And I can git clone the project "e2e-init-token-resync" using the "TASK_COMMITIZEN_TOKEN" token
    When the devsecops:init output is displayed in the browser
    Then the devsecops:init terminal output should visually match "e2e_init_token_resync_terminal"
