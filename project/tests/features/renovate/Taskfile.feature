@renovate-taskfile @scaffolding @taskfile
Feature: Renovate Taskfile Standardization
  As a DevSecOps engineer
  I want a standard Taskfile for Renovate operations
  So that I can use consistent commands and documentation

  @default
  Scenario: Verify Renovate Taskfile documentation
    Given a clean temporary directory for "renovate/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/renovate/Taskfile.yml" should exist
    And the file ".config/renovate/Taskfile.yml" should contain "desc: 🔄 Run Renovate with configurable options"
    And the file ".config/renovate/Taskfile.yml" should contain "desc: ✅ Verify prerequisites for npx usage"
    And the file ".config/renovate/Taskfile.yml" should contain "desc: 🔍 Validate the Renovate configuration file"
