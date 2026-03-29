@gum-taskfile @scaffolding @taskfile @gum
Feature: Gum Taskfile Standardization
  As a DevSecOps engineer
  I want a standard Taskfile for Gum operations
  So that I can use consistent commands and documentation

  @default
  Scenario: Verify Gum Taskfile documentation
    Given a clean temporary directory for "gum/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/gum/Taskfile.yml" should exist
    And the file ".config/gum/install.sh" should exist
    And the file ".config/gum/version" should contain "0.17.0"
    And the file ".config/dev/Taskfile.yml" should contain ".config/gum/install.sh"
    And the file ".config/gum/Taskfile.yml" should contain "desc: 📦 Install gum (Glamorous shell scripts)"
