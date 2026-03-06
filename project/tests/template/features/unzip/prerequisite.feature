@copier @scaffolding @unzip @prerequisite @unzip-init-guidance
Feature: Unzip prerequisite guidance
  As a DevSecOps engineer
  I want devsecops:init to guide users when unzip is missing
  So that first-time initialization stays simple on a fresh machine

  @taskfile
  Scenario: Generated project exposes the prerequisite installer in init
    Given a clean temporary directory for "unzip/prerequisite" tests
    When the copier command is executed with default settings
    Then the file ".config/unzip/Taskfile.yml" should exist
    And the task "prerequisites" in file ".config/devsecops/Taskfile.init.yml" should contain "task: :unzip:install:sudo"
    And the task "prerequisites" in file ".config/devsecops/Taskfile.init.yml" should contain "task devsecops:init"

  @check-installed
  Scenario: Generated unzip check guides users to the prerequisite installer
    Given a clean temporary directory for "unzip/prerequisite" tests
    When the copier command is executed with default settings
    Then the task "check:installed" in file ".config/unzip/Taskfile.yml" should contain "task devsecops:init:prerequisites"
    And the task "check:installed" in file ".config/unzip/Taskfile.yml" should contain "task devsecops:init"

  @dependency-order
  Scenario: Init checks unzip prerequisites before setup-environment
    Given a clean temporary directory for "unzip/prerequisite" tests
    When the copier command is executed with default settings
    Then the task "dependency" in file ".config/devsecops/Taskfile.init.yml" should contain "task: :unzip:check:installed"
    And the task "default" in file ".config/devsecops/Taskfile.init.yml" should contain "- task: dependency"
    And the task "default" in file ".config/devsecops/Taskfile.init.yml" should contain "- task: :dev:setup-environment"
    And the task "default" in file ".config/devsecops/Taskfile.init.yml" should contain "- task: dependency" before "- task: :dev:setup-environment"
