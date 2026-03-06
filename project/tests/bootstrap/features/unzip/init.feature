@bootstrap @unzip @bootstrap-unzip-init
Feature: Bootstrap init prerequisite scan with missing unzip
  As a first-time toolbox user
  I want devsecops:init to scan prerequisites before setup starts
  So that I can recover with one prerequisite installer command

  @ubuntu
  Scenario: Fresh Ubuntu guides users to the prerequisite installer
    Given a generated toolbox project is mounted in a fresh Ubuntu bootstrap container
    When I run "task devsecops:init" in the Ubuntu bootstrap container
    Then the bootstrap command should fail
    And the bootstrap command output should contain "task devsecops:init:prerequisites"
    And the bootstrap command output should contain "task devsecops:init"
    And the bootstrap command output should not contain "Permission denied"
    When I run "task devsecops:init:prerequisites" in the Ubuntu bootstrap container
    Then the bootstrap command output should contain "Installing unzip with sudo"
    And the bootstrap command output should contain "Re-running task devsecops:init"
    And "unzip" should be available in the Ubuntu bootstrap container
