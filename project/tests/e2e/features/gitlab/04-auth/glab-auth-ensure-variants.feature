@e2e @e2e-glab-auth-ensure @e2e-auth-variants
Feature: task glab:auth:ensure covers UI dependencies and host detection
  As a developer onboarding the toolbox
  I want `glab:auth:ensure` to fail fast on missing UI dependencies
  And to detect (and normalize) the GitLab host from my git remotes
  So that its guidance always names the right next command and the right host

  @e2e-auth-variants-missing-gum
  Scenario: ensure fails fast when gum is missing
    Given a fresh Ubuntu environment with the toolbox is set up
    When I run the command "task glab:auth:ensure" in the fresh Ubuntu environment
    Then the captured command should exit with a non-zero code
    And the captured output should contain "Required UI dependency missing: gum"
    And the captured output should contain "task dev:setup-environment"
    When the captured output is displayed in the browser
    Then the captured output should visually match "gitlab/04-auth/glab-auth-ensure-missing-gum-terminal"

  @e2e-auth-variants-missing-glow
  Scenario: ensure fails fast when glow is missing
    Given the fresh Ubuntu environment has "gum" installed
    When I run the command "task glab:auth:ensure" in the fresh Ubuntu environment
    Then the captured command should exit with a non-zero code
    And the captured output should contain "Required UI dependency missing: glow"
    And the captured output should contain "task dev:setup-environment"
    When the captured output is displayed in the browser
    Then the captured output should visually match "gitlab/04-auth/glab-auth-ensure-missing-glow-terminal"

  @e2e-auth-variants-self-hosted-host
  Scenario: ensure detects the self-hosted GitLab host from the remote
    Given the fresh Ubuntu environment has "gum", "glow" and "glab" installed with git remote "https://gitlab.selfhosted-corp.example/acme/widgets.git"
    When I run the command "CI=true task glab:auth:ensure" in the fresh Ubuntu environment
    Then the captured command should exit with a non-zero code
    And the captured output should contain "GitLab authentication required"
    And the captured output should contain "host        gitlab.selfhosted-corp.example"
    When the captured output is displayed in the browser
    Then the captured output should visually match "gitlab/04-auth/glab-auth-ensure-self-hosted-terminal"

  @e2e-auth-variants-gitlabssh
  Scenario: ensure normalizes gitlabssh.* remotes to the gitlab.* API host
    Given the fresh Ubuntu environment has "gum", "glow" and "glab" installed with git remote "git@gitlabssh.selfhosted-corp.example:acme/widgets.git"
    When I run the command "CI=true task glab:auth:ensure" in the fresh Ubuntu environment
    Then the captured command should exit with a non-zero code
    And the captured output should contain "host        gitlab.selfhosted-corp.example"
    And the captured output should not contain "gitlabssh"
    When the captured output is displayed in the browser
    Then the captured output should visually match "gitlab/04-auth/glab-auth-ensure-gitlabssh-terminal"
