@dependency-check @scaffolding @taskfile
Feature: Dependency-Check Taskfile Standardization
  As a DevSecOps engineer
  I want a standard Taskfile for Dependency-Check operations
  So that I can use consistent commands and documentation

  @default
  Scenario: Verify Dependency-Check Taskfile documentation
    Given a clean temporary directory for "dependency-check/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/dependency-check/Taskfile.yml" should exist
    And the file ".config/dependency-check/Taskfile.yml" should contain "desc: 📁 Prepare directories for Dependency-Check"
    And the file ".config/dependency-check/Taskfile.yml" should contain "desc: 🐳 Download latest Dependency-Check Docker image"
    And the file ".config/dependency-check/Taskfile.yml" should contain "desc: 🔍 Run Dependency-Check analysis"
