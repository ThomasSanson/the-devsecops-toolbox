@glow-taskfile @scaffolding @taskfile @glow
Feature: Glow Taskfile Standardization
  As a DevSecOps engineer
  I want a standard Taskfile for Glow operations
  So that I can use consistent commands and documentation

  @default
  Scenario: Verify Glow Taskfile documentation
    Given a clean temporary directory for "glow/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/glow/Taskfile.yml" should exist
    And the file ".config/glow/install.sh" should exist
    And the file ".config/glow/version" should contain "2.1.1"
    And the file ".config/dev/Taskfile.yml" should contain ".config/glow/install.sh"
    And the file ".config/glow/Taskfile.yml" should contain "desc: 📦 Install glow (Markdown renderer)"
