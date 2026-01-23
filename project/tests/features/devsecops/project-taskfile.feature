@copier @scaffolding @project @taskfile
Feature: Project Taskfile Configuration
  As a DevSecOps engineer
  I want the project Taskfile to be properly configured
  So that test coverage and task prefixes work correctly

  Scenario: Test taskfile contains correct variables with project mode enabled
    Given a clean temporary directory for project mode tests
    When the copier command is executed with project mode enabled
    Then the test taskfile should contain build coverage enabled
    And the test taskfile should contain build coverage task prefix "project"
    And the test taskfile should call project test task
    And the test taskfile should call project test tdd task

  Scenario: Test taskfile contains correct variables with project mode disabled
    Given a clean temporary directory for project mode tests
    When the copier command is executed with project mode disabled
    Then the test taskfile should contain build coverage disabled
    And the test taskfile should contain build coverage task prefix empty
    And the test taskfile should NOT call project test task
    And the test taskfile should NOT call project test tdd task

  Scenario: Project Taskfile uses flatten import with prefixed tasks
    Given a clean temporary directory for project mode tests
    When the copier command is executed with project mode enabled
    Then the root Taskfile should include the project taskfile as flatten
    And the project Taskfile should have the following prefixed tasks:
      | task             |
      | project:plan     |
      | project:code     |
      | project:build    |
      | project:test     |
      | project:test:tdd |
      | project:release  |
      | project:deploy   |
      | project:operate  |
      | project:monitor  |
      | project:feedback |
