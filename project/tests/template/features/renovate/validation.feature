@copier @renovate @validation
Feature: Renovate configuration validation
  As a DevSecOps engineer
  I want my Renovate configuration to be syntactically valid
  So that dependency updates work correctly

  @renovate-validation
  Scenario: Generated Renovate config passes validation
    Given a generated project for "renovate/validation" tests
    When I validate the Renovate configuration ".config/renovate/config.json"
    Then the Renovate configuration should be valid
