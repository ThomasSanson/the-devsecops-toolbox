@copier @scaffolding @ansible
Feature: Ansible Optional Integration
  As a DevSecOps engineer
  I want to generate a project without Ansible integration
  So that I can use the DevSecOps toolbox in projects that don't require Ansible

  @default
  Scenario: Generate project without Ansible integration (default behaviour)
    Given a clean temporary directory for Ansible tests
    When the copier command is executed with default settings for Ansible
    Then the generated project directory should exist
    And the ".config/ansible" directory should NOT exist
    And the ".config/ansible-lint" directory should NOT exist
    And the Taskfile should NOT include the Ansible taskfile reference

  Scenario: Generate project with Ansible integration
    Given a clean temporary directory for Ansible tests
    When the copier command is executed with Ansible enabled
    Then the generated project directory should exist
    And the ".config/ansible" directory should exist
    And the ".config/ansible-lint" directory should exist
    And the Taskfile should include the Ansible taskfile reference

  Scenario: Update project from Ansible enabled to disabled
    Given a clean temporary directory for Ansible tests
    And a project was generated with Ansible enabled
    When the project is updated with Ansible disabled
    Then the generated project directory should exist
    And the ".config/ansible" directory should NOT exist
    And the ".config/ansible-lint" directory should NOT exist
    And the Taskfile should NOT include the Ansible taskfile reference

  Scenario: Update project from Ansible disabled to enabled
    Given a clean temporary directory for Ansible tests
    And a project was generated with Ansible disabled
    When the project is updated with Ansible enabled
    Then the generated project directory should exist
    And the ".config/ansible" directory should exist
    And the ".config/ansible-lint" directory should exist
    And the Taskfile should include the Ansible taskfile reference
