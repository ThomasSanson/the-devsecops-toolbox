@copier @scaffolding @podman @runtime
Feature: Podman Container Runtime
  As a DevSecOps engineer
  I want to use Podman as container runtime
  So that I can build and manage containers with Podman

  @explicit
  Scenario: Generate project with Podman container runtime
    Given a clean temporary directory for "podman/runtime" tests
    When the copier command is executed with container runtime "podman"
    Then the ".config/podman" directory should exist
    And the ".config/podman/Taskfile.yml" file should exist
    And the ".config/docker-ce" directory should NOT exist
    And the root Taskfile should include the podman taskfile reference
    And the root Taskfile should NOT include the docker-ce taskfile reference

  @update
  Scenario: Update project from Docker to Podman
    Given a clean temporary directory for "podman/runtime" tests
    And a project was generated with container runtime "docker"
    When the project is updated with container runtime "podman"
    Then the ".config/podman" directory should exist
    And the ".config/podman/Taskfile.yml" file should exist
    And the root Taskfile should include the podman taskfile reference
    And the root Taskfile should NOT include the docker-ce taskfile reference
