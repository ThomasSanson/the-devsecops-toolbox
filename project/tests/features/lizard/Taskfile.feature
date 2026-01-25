@lizard @scaffolding @taskfile
Feature: Lizard Taskfile Standardization
  As a DevSecOps engineer
  I want a standard Taskfile for Lizard operations
  So that I can use consistent commands and documentation

  @default
  Scenario: Verify Lizard Taskfile documentation
    Given a clean temporary directory for "lizard/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/lizard/Taskfile.yml" should exist
    And the file ".config/lizard/Taskfile.yml" should contain "desc: 🦎 Analyze code complexity with Lizard"
    And the file ".config/lizard/Taskfile.yml" should contain "summary: |"
