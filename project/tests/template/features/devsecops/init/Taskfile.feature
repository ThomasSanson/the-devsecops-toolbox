@copier @scaffolding @devsecops @init
Feature: DevSecOps Init Taskfile Standardization
  As a DevSecOps engineer
  I want a standard Init Taskfile
  So that I can initialize projects with consistent commands

  @default
  Scenario: Init Taskfile exists and contains key tasks
    Given a clean temporary directory for "devsecops/init" tests
    When the copier command is executed with default settings
    Then the file ".config/devsecops/Taskfile.init.yml" should exist
    And the file ".config/devsecops/Taskfile.init.yml" should contain "desc: 🚀 Initialize DevSecOps project"
    And the file ".config/devsecops/Taskfile.init.yml" should contain "setup-gitlab"
    And the file ".config/devsecops/Taskfile.init.yml" should contain ":glab:merge-method"
