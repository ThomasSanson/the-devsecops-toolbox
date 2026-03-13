@bootstrap @unzip @bootstrap-unzip-init
Feature: Bootstrap init prerequisite scan with missing unzip
  As a first-time toolbox user
  I want devsecops:init to scan prerequisites before setup starts
  So that I can recover with one prerequisite installer command

  @ubuntu @ttyd
  Scenario: Fresh Ubuntu guides users to the prerequisite installer
    Given a generated toolbox project is mounted in a fresh Ubuntu ttyd container
    When I open the web terminal
    And I type "task devsecops:init" in the terminal and wait for completion
    Then the terminal output should visually match "init-fail-unzip-missing"
    When I type "task devsecops:init:prerequisites" in the terminal and wait for completion
    Then the terminal output should visually match "init-recovery-unzip"
