@e2e @e2e-template-matrix
Feature: Template rendering matrix — non-default Copier answers render correct projects
  As a DevSecOps engineer
  I want every Copier answer branch (runtime, compose, CI platform, ansible,
  automerge, project mode, gherkin language) to render the expected files
  So that a Jinja regression in a non-default branch can never ship silently

  # The default render — the load-bearing manifest the journey's ">= 200
  # created files" check cannot see.
  @e2e-template-matrix-defaults
  Scenario: Default answers render the canonical docker + compose + project layout
    Given a project rendered from the working-branch template with default answers
    Then the rendered path "project/Taskfile.yml" should exist
    And the rendered path ".config/docker-ce/Taskfile.yml" should exist
    And the rendered path ".config/podman" should not exist
    And the rendered path ".config/ansible" should not exist
    And the rendered path "project/docker-compose.yml" should exist
    And the rendered file "project/docker-compose.yml" should contain "networks:"
    And the rendered root Taskfile should reference ".config/docker-ce/Taskfile.yml"
    And the rendered root Taskfile should reference "project/Taskfile.yml"
    And the rendered root Taskfile should not reference ".config/podman/Taskfile.yml"
    And the rendered CI variables should contain "DOCKER_HOST: tcp://docker:2376"
    And the rendered file ".config/gitlab/ci/devsecops/release.yml" should contain "after_script:"
    And the rendered file ".agent/rules/tests-structure.md" should contain "Gherkin in **en**"
    And the rendered path ".config/devsecops/.copier-answers.yml" should exist
    And the rendered renovate config should be valid JSON
    And the rendered toolbox package rule should enable fast-forward automerge
    And the rendered configuration layout should visually match "template/matrix-defaults"

  @e2e-template-matrix-podman
  Scenario: Podman runtime renders podman config and drops docker-ce and compose
    Given a project rendered from the working-branch template with answers "container_runtime=podman"
    Then the rendered path ".config/podman/Taskfile.yml" should exist
    And the rendered path ".config/docker-ce" should not exist
    And the rendered path "project/docker-compose.yml" should not exist
    And the rendered root Taskfile should reference ".config/podman/Taskfile.yml"
    And the rendered root Taskfile should not reference ".config/docker-ce/Taskfile.yml"
    And the rendered configuration layout should visually match "template/matrix-podman"

  @e2e-template-matrix-no-compose
  Scenario: Disabling docker compose drops the compose file but keeps docker-ce
    Given a project rendered from the working-branch template with answers "use_docker_compose=false"
    Then the rendered path "project/docker-compose.yml" should not exist
    And the rendered path ".config/docker-ce/Taskfile.yml" should exist

  @e2e-template-matrix-ansible
  Scenario: Enabling ansible renders the ansible config and taskfile include
    Given a project rendered from the working-branch template with answers "ansible_enabled=true"
    Then the rendered path ".config/ansible/Taskfile.yml" should exist
    And the rendered path ".config/ansible-lint" should exist
    And the rendered root Taskfile should reference ".config/ansible/Taskfile.yml"
    And the rendered configuration layout should visually match "template/matrix-ansible"

  @e2e-template-matrix-self-hosted
  Scenario: Self-hosted CI platform renders custom Docker variables
    Given a project rendered from the working-branch template with answers "ci_platform=gitlab_self_hosted gitlab_docker_host= gitlab_docker_tls_certdir="
    Then the rendered CI variables should not contain "DOCKER_HOST: tcp://docker:2376"
    And the rendered CI variables should set "DOCKER_TLS_CERTDIR" to an empty value

  @e2e-template-matrix-no-project
  Scenario: Disabling project mode drops the project directory and its include
    Given a project rendered from the working-branch template with answers "project_enabled=false"
    Then the rendered path "project" should not exist
    And the rendered root Taskfile should not reference "project/Taskfile.yml"
    And the rendered configuration layout should visually match "template/matrix-no-project"

  @e2e-template-matrix-automerge-off
  Scenario: Disabling automerge renders a valid renovate config without automerge rules
    Given a project rendered from the working-branch template with answers "devsecops_automerge=false"
    Then the rendered renovate config should be valid JSON
    And the rendered toolbox package rule should not enable automerge

  @e2e-template-matrix-gherkin-fr
  Scenario: French gherkin language is propagated to the test-structure rules
    Given a project rendered from the working-branch template with answers "gherkin_language=fr"
    Then the rendered file ".agent/rules/tests-structure.md" should contain "Gherkin in **fr**"
