@bootstrap @glab @bootstrap-glab-guidance
Feature: Bootstrap guidance for GitLab authentication and remote alignment
  As a first-time toolbox user
  I want init failures related to glab to provide actionable guidance
  So that I can recover quickly and re-run the initialization command

  @ubuntu @ttyd
  Scenario: Missing authentication on a GitLab remote suggests how to log in
    Given a generated toolbox project with git remote "https://gitlab.com/example/bootstrap-guidance.git" is mounted in a fresh Ubuntu ttyd container
    When I open the web terminal
    And I type "task devsecops:init" in the terminal and wait for completion
    Then the terminal output should visually match "glab-missing-auth"

  @ubuntu @ttyd
  Scenario: Non-GitLab remote suggests how to align the repository host
    Given a generated toolbox project with git remote "https://github.com/example/bootstrap-guidance.git" is mounted in a fresh Ubuntu ttyd container
    When I open the web terminal
    And I type "task devsecops:init" in the terminal and wait for completion
    Then the terminal output should visually match "glab-non-gitlab-remote"

  @ubuntu @ttyd
  Scenario: GitLab host mismatch suggests host-specific authentication
    Given a generated toolbox project with git remote "https://gitlab.self-hosted.local/example/bootstrap-guidance.git" is mounted in a fresh Ubuntu ttyd container
    When I open the web terminal
    And I type "task devsecops:init" in the terminal and wait for completion
    Then the terminal output should visually match "glab-host-mismatch"

  @ubuntu @ttyd
  Scenario: Init can complete without glab guidance when GitLab setup is disabled
    Given a generated toolbox project is mounted in a fresh Ubuntu ttyd container with extra packages "git unzip"
    When I open the web terminal
    And I type "TASK_GLAB_ENABLED=false task devsecops:init" in the terminal and wait for completion
    Then the terminal output should visually match "glab-disabled-success"
