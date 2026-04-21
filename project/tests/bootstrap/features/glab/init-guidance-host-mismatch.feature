@bootstrap @glab @bootstrap-glab-guidance
Feature: Bootstrap guidance when the GitLab host differs from the authenticated host
  As a first-time toolbox user
  I want init failures related to GitLab host mismatch to provide actionable guidance
  So that I can recover quickly and re-run the initialization command

  @ubuntu @ttyd
  Scenario: GitLab host mismatch suggests host-specific authentication
    Given a generated toolbox project with git remote "https://gitlab.self-hosted.local/example/bootstrap-guidance.git" is mounted in a fresh Ubuntu ttyd container
    When I open the web terminal
    And I type "task devsecops:init" in the terminal and wait for completion
    Then the terminal output should visually match "glab-host-mismatch"
