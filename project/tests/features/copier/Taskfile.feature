@copier-taskfile @scaffolding @taskfile
Feature: Copier Taskfile Standardization
  As a DevSecOps engineer
  I want a standard Taskfile for Copier operations
  So that I can use consistent commands and documentation

  @default
  Scenario: Verify Copier Taskfile documentation
    Given a clean temporary directory for "copier/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/copier/Taskfile.yml" should exist
    And the file ".config/copier/Taskfile.yml" should contain "desc: ⚙️ Run Copier with specified options"
    And the file ".config/copier/Taskfile.yml" should contain "summary: |"
    And the file ".config/copier/Taskfile.yml" should contain "desc: 🔄 Update project using Copier"
