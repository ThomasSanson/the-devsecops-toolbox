@e2e @e2e-template-renovate
Feature: The rendered renovate configuration passes the real Renovate validator
  As a maintainer of a generated project
  I want both branches of the templated renovate config (automerge on/off)
  validated by renovate-config-validator itself — not just JSON.parse
  So that an invalid rendered config can never ship to downstream projects

  @e2e-template-renovate-validate-default
  Scenario: the default render (automerge on) passes renovate-config-validator
    Given a project rendered from the working-branch template with default answers
    When I run the renovate config validation in the rendered project
    Then the renovate validation should succeed
    And the renovate validation output should contain "Config validated successfully"
    And the renovate validation verdict should visually match "template/renovate-validate-default"

  @e2e-template-renovate-validate-automerge-off
  Scenario: the automerge-off render passes renovate-config-validator
    Given a project rendered from the working-branch template with answers "devsecops_automerge=false"
    When I run the renovate config validation in the rendered project
    Then the renovate validation should succeed
    And the renovate validation output should contain "Config validated successfully"
    And the renovate validation verdict should visually match "template/renovate-validate-automerge-off"
