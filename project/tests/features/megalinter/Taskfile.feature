@megalinter-taskfile @scaffolding @taskfile
Feature: Megalinter Taskfile Standardization
  As a DevSecOps engineer
  I want a standard Taskfile for Megalinter operations
  So that I can use consistent commands and documentation

  @default
  Scenario: Verify Megalinter Taskfile documentation
    Given a clean temporary directory for "megalinter/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/megalinter/Taskfile.yml" should exist
    And the file ".config/megalinter/Taskfile.yml" should contain "desc: 🐳 Run MegaLinter for comprehensive code analysis"
    And the file ".config/megalinter/Taskfile.yml" should contain "desc: 🚀 Run MegaLinter locally via npx"
