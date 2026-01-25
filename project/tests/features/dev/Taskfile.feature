@dev-taskfile @scaffolding @taskfile
Feature: Dev Taskfile Standardization
  As a DevSecOps engineer
  I want a standard Taskfile for Dev operations
  So that I can use consistent commands and documentation

  @default
  Scenario: Verify Dev Taskfile documentation
    Given a clean temporary directory for "dev/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/dev/Taskfile.yml" should exist
    And the file ".config/dev/Taskfile.yml" should contain "desc: 🚀 Run all CI/CD initialization steps"
    And the file ".config/dev/Taskfile.yml" should contain "desc: ⚙️ Configure the development environment"
