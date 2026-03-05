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
    And the file ".config/devsecops/Taskfile.init.yml" should contain ":glab:merge-settings"

  @post-copy
  Scenario: Copier template runs devsecops:init after first copy
    Given a clean temporary directory for "devsecops/init" tests
    Then the source template file "copier.yml" should contain "_tasks"
    And the source template file "copier.yml" should contain "task devsecops:init"
    And the source template file "copier.yml" should contain "_copier_operation == 'copy'"

  @renovate-token
  Scenario: Init Taskfile includes renovate-token in setup-gitlab
    Given a clean temporary directory for "devsecops/init" tests
    When the copier command is executed with default settings
    Then the file ".config/devsecops/Taskfile.init.yml" should contain ":glab:renovate-token"

  @commitizen-token
  Scenario: Init Taskfile includes commitizen-token and removes deploy-key from setup-gitlab
    Given a clean temporary directory for "devsecops/init" tests
    When the copier command is executed with default settings
    Then the file ".config/devsecops/Taskfile.init.yml" should contain ":glab:commitizen-token"
    And the file ".config/devsecops/Taskfile.init.yml" should NOT contain ":glab:deploy-key"
