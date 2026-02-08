@copier @scaffolding @glab @tool
Feature: Glab GitLab CLI Tool
  As a DevSecOps engineer
  I want to have glab (GitLab CLI) integrated in my project
  So that I can interact with GitLab from the command line

  @default
  Scenario: Generate project with glab configuration
    Given a clean temporary directory for "glab" tests
    When the copier command is executed with default settings
    Then the ".config/glab" directory should exist
    And the ".config/glab/Taskfile.yml" file should exist
    And the ".config/glab/install.sh" file should exist

  @taskfile
  Scenario: Generated Taskfile includes glab reference
    Given a clean temporary directory for "glab" tests
    When the copier command is executed with default settings
    Then the root Taskfile should include the glab taskfile reference
