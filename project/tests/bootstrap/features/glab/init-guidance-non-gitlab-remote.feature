@bootstrap @glab @bootstrap-glab-guidance
Feature: Bootstrap guidance when a repository remote is not on GitLab
  As a first-time toolbox user
  I want init failures related to non-GitLab remotes to provide actionable guidance
  So that I can recover quickly and re-run the initialization command

  @ubuntu @ttyd
  Scenario: Non-GitLab remote suggests how to align the repository host
    Given a generated toolbox project with git remote "https://github.com/example/bootstrap-guidance.git" is mounted in a fresh Ubuntu ttyd container
    When I open the web terminal
    And I type "task devsecops:init" in the terminal and wait for completion
    Then the terminal output should visually match "glab-non-gitlab-remote"
