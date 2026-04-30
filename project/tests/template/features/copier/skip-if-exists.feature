@copier @scaffolding @skip-if-exists
Feature: Copier preserves user-customized project files on update
  As a DevSecOps engineer
  I want my customizations of project/Taskfile.yml and project/docker-compose.yml
  To survive a `task devsecops:code:sync-templates` (copier update)

  @sync-template-preserves-project-taskfile
  Scenario: copier update preserves a customized project/Taskfile.yml
    Given a clean temporary directory for "copier/skip-if-exists" tests
    And a project was generated with project mode enabled
    When the file "project/Taskfile.yml" is customized with the marker "@CUSTOM_TASKFILE_MARKER"
    And the project is updated keeping all answers
    Then the file "project/Taskfile.yml" should still contain the marker "@CUSTOM_TASKFILE_MARKER"

  @sync-template-preserves-project-docker-compose
  Scenario: copier update preserves a customized project/docker-compose.yml
    Given a clean temporary directory for "copier/skip-if-exists" tests
    And a project was generated with project mode enabled
    When the file "project/docker-compose.yml" is customized with the marker "@CUSTOM_COMPOSE_MARKER"
    And the project is updated keeping all answers
    Then the file "project/docker-compose.yml" should still contain the marker "@CUSTOM_COMPOSE_MARKER"
