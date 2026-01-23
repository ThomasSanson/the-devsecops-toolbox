@copier @scaffolding @docker @runtime
Feature: Docker Container Runtime
  As a DevSecOps engineer
  I want to use Docker as container runtime
  So that I can build and manage containers with Docker

  @default
  Scenario: Generate project with Docker as default container runtime
    Given a clean temporary directory for "docker/runtime" tests
    When the copier command is executed with default settings
    Then the ".config/docker-ce" directory should exist
    And the ".config/docker-ce/Taskfile.yml" file should exist
    And the ".config/podman" directory should NOT exist
    And the root Taskfile should include the docker-ce taskfile reference
    And the root Taskfile should NOT include the podman taskfile reference

  @explicit
  Scenario: Generate project with Docker container runtime explicitly
    Given a clean temporary directory for "docker/runtime" tests
    When the copier command is executed with container runtime "docker"
    Then the ".config/docker-ce" directory should exist
    And the ".config/docker-ce/Taskfile.yml" file should exist
    And the ".config/podman" directory should NOT exist
    And the root Taskfile should include the docker-ce taskfile reference
    And the root Taskfile should NOT include the podman taskfile reference

  @update
  Scenario: Update project from Podman to Docker
    Given a clean temporary directory for "docker/runtime" tests
    And a project was generated with container runtime "podman"
    When the project is updated with container runtime "docker"
    Then the ".config/docker-ce" directory should exist
    And the ".config/docker-ce/Taskfile.yml" file should exist
    And the root Taskfile should include the docker-ce taskfile reference
    And the root Taskfile should NOT include the podman taskfile reference
