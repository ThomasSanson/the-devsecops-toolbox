@commitizen @config
Feature: Commitizen Configuration
  As a DevSecOps engineer
  I want the generated project to have a valid Commitizen configuration
  So that I can use conventional commits with automatic versioning

  Scenario: Generated project has valid Commitizen configuration
    Given a clean temporary directory for "commitizen/config" tests
    When the copier command is executed with default settings
    Then the ".config/commitizen/cz.yaml" file should exist
    And the commitizen configuration should have the version "0.1.0"
    And the commitizen "version_files" configuration should NOT contain ".gitlab-ci.yml"
