@e2e @e2e-copier-update
Feature: Copier update — the Renovate-driven upgrade path
  As a maintainer of a generated project
  I want `copier update` (what Renovate's postUpgradeTasks automates) to apply
  template changes while preserving my customized skip-if-exists files
  So that toolbox releases never destroy downstream customizations

  @e2e-copier-update-skip-if-exists
  Scenario: copier update preserves customized skip-if-exists files and applies template changes
    Given a versioned working-branch template with releases "1.0.0" and "1.0.1"
    And a project generated from the template at release "1.0.0"
    And the project file "project/Taskfile.yml" is customized with the marker "# CUSTOM-TASKFILE-MARKER"
    When the project is updated to template release "1.0.1"
    Then the rendered file "project/Taskfile.yml" should contain "# CUSTOM-TASKFILE-MARKER"
    And the rendered file ".config/jq/Taskfile.yml" should contain "# e2e-update-marker"
    And the rendered file ".config/devsecops/.copier-answers.yml" should contain "_commit: 1.0.1"

  @e2e-copier-update-option-flip
  Scenario: copier update can flip the ansible option on an existing project
    Given a versioned working-branch template with releases "1.0.0" and "1.0.1"
    And a project generated from the template at release "1.0.0"
    And the rendered path ".config/ansible" should not exist
    When the project is updated to template release "1.0.1" with answers "ansible_enabled=true"
    Then the rendered path ".config/ansible/Taskfile.yml" should exist
    And the rendered path ".config/ansible-lint" should exist
    And the rendered root Taskfile should reference ".config/ansible/Taskfile.yml"
    And the rendered configuration layout should visually match "template/update-ansible-flip"
