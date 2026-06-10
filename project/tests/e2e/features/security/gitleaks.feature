@e2e @e2e-gitleaks
Feature: Gitleaks secret scanning works on a generated project
  As a developer using a generated project
  I want `task gitleaks:scan-branch` to detect committed secrets and stay
  silent on clean branches and gitignored files
  So that the framework's core security promise actually holds

  @e2e-gitleaks-clean
  Scenario: scan-branch passes on a clean branch with tracked, untracked and ignored files
    Given a git-initialized project rendered from the working-branch template
    And selective-copy fixtures exist on a feature branch
    When I run gitleaks scan-branch in the project
    Then the gitleaks run should succeed
    And the gitleaks output should contain "No secrets detected in branch commits."
    And the gitleaks verdict should visually match "security/gitleaks-clean"

  @e2e-gitleaks-committed-secret
  Scenario: scan-branch fails when a fake private key is committed on the branch
    Given a git-initialized project rendered from the working-branch template
    And a tracked file containing a fake private key is committed on a feature branch
    When I run gitleaks scan-branch in the project
    Then the gitleaks run should fail
    And the gitleaks output should contain "Gitleaks detected secrets in your branch commits!"
    And the gitleaks verdict should visually match "security/gitleaks-committed-secret"

  @e2e-gitleaks-ignored-secret
  Scenario: scan-branch ignores a fake private key stored in a gitignored file
    Given a git-initialized project rendered from the working-branch template
    And an ignored file containing a fake private key exists on a feature branch
    When I run gitleaks scan-branch in the project
    Then the gitleaks run should succeed
    And the gitleaks output should contain "No secrets detected in branch commits."
