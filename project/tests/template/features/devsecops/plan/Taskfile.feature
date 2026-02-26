@copier @scaffolding @devsecops @plan
Feature: DevSecOps Plan Taskfile Standardization
  As a DevSecOps engineer
  I want a standard Taskfile for the Plan phase
  So that I can understand how to use the planning tasks

  @default
  Scenario: Verify DevSecOps Plan Taskfile documentation
    Given a clean temporary directory for "devsecops/plan" tests
    When the copier command is executed with default settings
    Then the file ".config/devsecops/Taskfile.plan.yml" should exist
    And the file ".config/devsecops/Taskfile.plan.yml" should contain "desc: 📋 Run all generic plan tasks"
    And the file ".config/devsecops/Taskfile.plan.yml" should contain "summary: |"
    And the file ".config/devsecops/Taskfile.plan.yml" should contain "Orchestrates the planning phase"
