@copier @scaffolding @project @taskfile
Feature: Project Taskfile Standardization
  As a DevSecOps engineer
  I want a standard Taskfile for project orchestration
  So that I can understand and use the project lifecycle tasks

  @default
  Scenario: Verify Project Taskfile documentation
    Given a clean temporary directory for "project/taskfile" tests
    When the copier command is executed with default settings
    Then the file "project/Taskfile.yml" should exist
    And the file "project/Taskfile.yml" should contain "desc: 🚀 Run project-specific plan tasks"
    And the file "project/Taskfile.yml" should contain "summary: |"
    And the file "project/Taskfile.yml" should contain "Orchestrates the plan phase"
    And the file "project/Taskfile.yml" should contain "desc: 🚀 Run project-specific code tasks"
    And the file "project/Taskfile.yml" should contain "desc: 🚀 Run project-specific build tasks"
    And the file "project/Taskfile.yml" should contain "desc: 🚀 Run project-specific test tasks"
    And the file "project/Taskfile.yml" should contain "desc: 🚀 Run project-specific release tasks"
    And the file "project/Taskfile.yml" should contain "desc: 🚀 Run project-specific deploy tasks"
    And the file "project/Taskfile.yml" should contain "desc: 🚀 Run project-specific operate tasks"
    And the file "project/Taskfile.yml" should contain "desc: 🚀 Run project-specific monitor tasks"
    And the file "project/Taskfile.yml" should contain "desc: 🚀 Run project-specific feedback tasks"
