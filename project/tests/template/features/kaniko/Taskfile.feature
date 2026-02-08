@kaniko-taskfile @scaffolding @taskfile
Feature: Kaniko Taskfile Standardization
  As a DevSecOps engineer
  I want a standard Taskfile for Kaniko operations
  So that I can use consistent commands and documentation

  @default
  Scenario: Verify Kaniko Taskfile documentation
    Given a clean temporary directory for "kaniko/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/kaniko/Taskfile.yml" should exist
    And the file ".config/kaniko/Taskfile.yml" should contain "desc: 🐳 Build a container image with Kaniko"
    And the file ".config/kaniko/Taskfile.yml" should contain "desc: 🔥 Warm up Kaniko cache with base images"
