@copier @scaffolding @devsecops @git-prerequisites-move
Feature: Installer delegates git checks to init prerequisites
  As a DevSecOps engineer
  I want the bootstrap installer to avoid direct git preflight checks
  So that git prerequisite handling stays centralized in devsecops:init:prerequisites

  Scenario: Generated install script no longer checks git repository state
    Given a clean temporary directory for "devsecops/install-script-git-prerequisite" tests
    When the copier command is executed with default settings
    Then the file ".config/devsecops/install.sh" should exist
    And the file ".config/devsecops/install.sh" should NOT contain "git rev-parse --is-inside-work-tree"
    And the file ".config/devsecops/install.sh" should NOT contain "Not inside a git repository."

  Scenario: Generated install script checks git presence and minimum version
    Given a clean temporary directory for "devsecops/install-script-git-prerequisite" tests
    When the copier command is executed with default settings
    Then the file ".config/devsecops/install.sh" should contain "GIT_MIN_VERSION="
    And the file ".config/devsecops/install.sh" should contain "Git is required to scaffold this project with Copier."
    And the file ".config/devsecops/install.sh" should contain "Install Git now? [Y/n]: "
    And the file ".config/devsecops/install.sh" should contain "v${GIT_MIN_VERSION}+ is required."

  Scenario: Generated install script supports template source overrides for local testing
    Given a clean temporary directory for "devsecops/install-script-git-prerequisite" tests
    When the copier command is executed with default settings
    Then the file ".config/devsecops/install.sh" should contain "DEVSECOPS_TEMPLATE_URL"
    And the file ".config/devsecops/install.sh" should contain "DEVSECOPS_TEMPLATE_VCS_REF"
    And the file ".config/devsecops/install.sh" should contain "Template source:"

  Scenario: Generated install script retries init after installing prerequisites
    Given a clean temporary directory for "devsecops/install-script-git-prerequisite" tests
    When the copier command is executed with default settings
    Then the file ".config/devsecops/install.sh" should contain "task devsecops:init:prerequisites"
    And the file ".config/devsecops/install.sh" should contain "Retrying project initialization"

  Scenario: Generated install script skips copier post-copy tasks to control init flow
    Given a clean temporary directory for "devsecops/install-script-git-prerequisite" tests
    When the copier command is executed with default settings
    Then the file ".config/devsecops/install.sh" should contain "--skip-tasks"

  Scenario: Generated install script falls back to /dev/tty for interactive piped execution
    Given a clean temporary directory for "devsecops/install-script-git-prerequisite" tests
    When the copier command is executed with default settings
    Then the file ".config/devsecops/install.sh" should contain "INTERACTIVE_INPUT=\"$(resolve_interactive_input)\""
    And the file ".config/devsecops/install.sh" should contain "if [ ! -t 0 ] && [ -r /dev/tty ] && (: </dev/tty) 2>/dev/null; then"
    And the file ".config/devsecops/install.sh" should contain "sh -c \"$command\" </dev/tty"
