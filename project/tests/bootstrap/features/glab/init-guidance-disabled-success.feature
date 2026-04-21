@bootstrap @glab @bootstrap-glab-guidance
Feature: Bootstrap succeeds without glab guidance when GitLab setup is disabled
  As a toolbox user who opted out of GitLab integration
  I want init to complete cleanly when glab is disabled
  So that I do not see GitLab-specific guidance in my workflow

  @ubuntu @ttyd
  Scenario: Init can complete without glab guidance when GitLab setup is disabled
    Given a generated toolbox project is mounted in a fresh Ubuntu ttyd container with extra packages "git unzip"
    When I open the web terminal
    And I type "TASK_GLAB_ENABLED=false task devsecops:init" in the terminal and wait for completion
    Then the terminal output should visually match "glab-disabled-success"
