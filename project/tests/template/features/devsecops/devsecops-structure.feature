@copier @scaffolding @devsecops @structure
Feature: DevSecOps Taskfile Structure
  As a DevSecOps engineer
  I want my generated project to have a complete DevSecOps Taskfile structure
  So that all phases of the DevSecOps lifecycle are properly organized

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
