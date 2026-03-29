@bootstrap @gum @bootstrap-gum-install
Feature: Gum Installation DX
  As a first-time toolbox user
  I want standalone gum installation to show clear visual feedback
  So that I know the glamorous shell script tool is ready

  @ubuntu @ttyd
  Scenario: Standalone gum install
    Given a generated toolbox project is mounted in a fresh Ubuntu ttyd container
    When I open the web terminal
    And I type "task gum:install" in the terminal and wait for completion
    Then the terminal output should visually match "gum-install-success"
