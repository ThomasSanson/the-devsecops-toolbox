@yamllint @scaffolding @taskfile
Feature: Yamllint Taskfile Standardization
  As a DevSecOps engineer
  I want a standard Taskfile for Yamllint operations
  So that I can use consistent commands and documentation

  @default
  Scenario: Verify Yamllint Taskfile documentation
    Given a clean temporary directory for "yamllint/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/yamllint/Taskfile.yml" should exist
    And the file ".config/yamllint/Taskfile.yml" should contain "desc: 🧪 Lint YAML files using yamllint"
    And the file ".config/yamllint/Taskfile.yml" should contain "summary: |"
