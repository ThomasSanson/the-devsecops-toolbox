@bootstrap @glab @bootstrap-glab-guidance
Feature: Bootstrap guidance when a GitLab remote is not authenticated
  As a first-time toolbox user
  I want init failures related to glab authentication to provide actionable guidance
  So that I can recover quickly and re-run the initialization command

  @ubuntu @ttyd
  Scenario: Missing authentication on a GitLab remote suggests how to log in
    Given a generated toolbox project with git remote "https://gitlab.com/example/bootstrap-guidance.git" is mounted in a fresh Ubuntu ttyd container
    When I open the web terminal
    And I type "task devsecops:init" in the terminal and wait for completion
    Then the terminal output should visually match "glab-missing-auth"
