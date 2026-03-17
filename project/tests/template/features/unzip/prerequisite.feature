@copier @scaffolding @unzip @prerequisite @unzip-init-guidance
Feature: Unzip prerequisite guidance
  As a DevSecOps engineer
  I want devsecops:init to guide users when unzip is missing
  So that first-time initialization stays simple on a fresh machine

  @taskfile @git-prerequisites-move
  Scenario: Generated project exposes the prerequisite installer in init
    Given a clean temporary directory for "unzip/prerequisite" tests
    When the copier command is executed with default settings
    Then the file ".config/unzip/Taskfile.yml" should exist
    And the task "prerequisites" in file ".config/devsecops/Taskfile.init.yml" should contain "task: :git:install"
    And the task "prerequisites" in file ".config/devsecops/Taskfile.init.yml" should contain "task: :unzip:install:sudo"
    And the task "prerequisites" in file ".config/devsecops/Taskfile.init.yml" should contain "task: :git:install" before "task: :unzip:install:sudo"
    And the task "default" in file ".config/devsecops/Taskfile.init.yml" should contain "task :unzip:check:installed || task devsecops:init:prerequisites"

  @check-installed
  Scenario: Generated unzip check guides users to the prerequisite installer
    Given a clean temporary directory for "unzip/prerequisite" tests
    When the copier command is executed with default settings
    Then the task "check:installed" in file ".config/unzip/Taskfile.yml" should contain "task devsecops:init:prerequisites"
    And the task "check:installed" in file ".config/unzip/Taskfile.yml" should contain "task devsecops:init"

  @dependency-order
  Scenario: Init auto-runs prerequisites before setup-environment when needed
    Given a clean temporary directory for "unzip/prerequisite" tests
    When the copier command is executed with default settings
    Then the task "default" in file ".config/devsecops/Taskfile.init.yml" should contain "task :unzip:check:installed || task devsecops:init:prerequisites"
    And the task "default" in file ".config/devsecops/Taskfile.init.yml" should contain "task: :dev:setup-environment"
    And the task "default" in file ".config/devsecops/Taskfile.init.yml" should contain "task :unzip:check:installed || task devsecops:init:prerequisites" before "task: :dev:setup-environment"
