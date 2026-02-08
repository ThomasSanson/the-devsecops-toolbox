@copier @scaffolding @project @project-mode
Feature: Project Mode Activation and Deactivation
  As a DevSecOps engineer
  I want to enable or disable project mode integration
  So that I can use the DevSecOps toolbox with or without custom project-specific tasks

  @default
  Scenario: Generate project with project mode integration (default behaviour)
    Given a clean temporary directory for "devsecops/project-mode" tests
    When the copier command is executed with default settings for project mode
    Then the "project" directory should exist
    And the "project/Taskfile.yml" file should exist
    And the root Taskfile should include the project taskfile reference
    And the following DevSecOps Taskfiles should call the project tasks:
      | phase    |
      | plan     |
      | code     |
      | build    |
      | test     |
      | release  |
      | deploy   |
      | operate  |
      | monitor  |
      | feedback |

  Scenario: Generate project without project mode integration
    Given a clean temporary directory for "devsecops/project-mode" tests
    When the copier command is executed with project mode disabled
    Then the "project" directory should NOT exist
    And the "project/Taskfile.yml" file should NOT exist
    And the root Taskfile should NOT include the project taskfile reference
    And the following DevSecOps Taskfiles should NOT call any project tasks:
      | phase    |
      | plan     |
      | code     |
      | build    |
      | test     |
      | release  |
      | deploy   |
      | operate  |
      | monitor  |
      | feedback |

  Scenario: Update project from project mode enabled to disabled
    Given a clean temporary directory for "devsecops/project-mode" tests
    And a project was generated with project mode enabled
    When the project is updated with project mode disabled
    Then the "project" directory should exist
    And the "project/Taskfile.yml" file should NOT exist
    And the root Taskfile should NOT include the project taskfile reference
    And the following DevSecOps Taskfiles should NOT call any project tasks:
      | phase    |
      | plan     |
      | code     |
      | build    |
      | test     |
      | release  |
      | deploy   |
      | operate  |
      | monitor  |
      | feedback |

  Scenario: Update project from project mode disabled to enabled
    Given a clean temporary directory for "devsecops/project-mode" tests
    And a project was generated with project mode disabled
    When the project is updated with project mode enabled
    Then the "project" directory should exist
    And the "project/Taskfile.yml" file should exist
    And the root Taskfile should include the project taskfile reference
    And the following DevSecOps Taskfiles should call the project tasks:
      | phase    |
      | plan     |
      | code     |
      | build    |
      | test     |
      | release  |
      | deploy   |
      | operate  |
      | monitor  |
      | feedback |
