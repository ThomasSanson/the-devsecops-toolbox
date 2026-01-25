@lefthook-taskfile @scaffolding @taskfile
Feature: Lefthook Taskfile Standardization
  As a DevSecOps engineer
  I want a standard Taskfile for Lefthook operations
  So that I can use consistent commands and documentation

  @default
  Scenario: Verify Lefthook Taskfile documentation
    Given a clean temporary directory for "lefthook/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/lefthook/Taskfile.yml" should exist
    And the file ".config/lefthook/Taskfile.yml" should contain "desc: 📥 Install Lefthook using Go"
    And the file ".config/lefthook/Taskfile.yml" should contain "desc: 🪝 Install and configure Lefthook Git hooks"
