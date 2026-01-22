@copier @scaffolding @project
Feature: Project Mode Optional Integration
  As a DevSecOps engineer
  I want to generate a project with or without project mode integration
  So that I can use the DevSecOps toolbox with or without custom project-specific tasks

  @default
  Scenario: Generate project with project mode integration (default behaviour)
    Given a clean temporary directory for project mode tests
    When the copier command is executed with default settings for project mode
    Then the project mode "project" directory should exist
    And the project mode "project/Taskfile.yml" file should exist
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
    Given a clean temporary directory for project mode tests
    When the copier command is executed with project mode disabled
    Then the project mode "project" directory should NOT exist
    And the project mode "project/Taskfile.yml" file should NOT exist
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
    Given a clean temporary directory for project mode tests
    And a project was generated with project mode enabled
    When the project is updated with project mode disabled
    Then the project mode "project" directory should exist
    And the project mode "project/Taskfile.yml" file should NOT exist
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
    Given a clean temporary directory for project mode tests
    And a project was generated with project mode disabled
    When the project is updated with project mode enabled
    Then the project mode "project" directory should exist
    And the project mode "project/Taskfile.yml" file should exist
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

  Scenario: Generated project has complete DevSecOps Taskfile structure
    Given a generated project from the Copier template
    Then the "Taskfile.yml" file should exist
    And the ".config/devsecops/Taskfile.plan.yml" file should exist
    And the ".config/devsecops/Taskfile.code.yml" file should exist
    And the ".config/devsecops/Taskfile.build.yml" file should exist
    And the ".config/devsecops/Taskfile.test.yml" file should exist
    And the ".config/devsecops/Taskfile.release.yml" file should exist
    And the ".config/devsecops/Taskfile.deploy.yml" file should exist
    And the ".config/devsecops/Taskfile.operate.yml" file should exist
    And the ".config/devsecops/Taskfile.monitor.yml" file should exist
    And the ".config/devsecops/Taskfile.feedback.yml" file should exist
    And the content of the file ".config/devsecops/Taskfile.code.yml" should contain:
      """
        sync-templates:
      """
    And the file "Taskfile.yml" should NOT contain double blank lines
    And the "includes" section of "Taskfile.yml" should NOT contain any blank lines
    And the content of the file ".config/devsecops/Taskfile.monitor.yml" should contain:
      """
      tasks:
        default:
          desc: Run all generic monitor tasks
          status:
            - test "{{.TASK_DEVSECOPS_MONITOR_ENABLED}}" = "false"
          cmds:
            - cmd: echo "🔄 Starting monitor phase"
              silent: true
            - task: :project:monitor
            - cmd: echo "🎉 Monitor phase completed successfully"
              silent: true
      """
