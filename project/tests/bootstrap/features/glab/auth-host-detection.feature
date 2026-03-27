@bootstrap @glab @bootstrap-glab-auth-host-detection
Feature: Bootstrap glab auth host auto-detection
  As a toolbox user on a self-hosted GitLab instance
  I want the auth task to auto-detect the GitLab host from git remotes
  So that I do not need to manually specify the hostname

  @ubuntu @ttyd
  Scenario: task glab:auth detects self-hosted GitLab host and passes --hostname
    Given a generated toolbox project with git remote "https://gitlab.self-hosted.local/org/project.git" is mounted in a fresh Ubuntu ttyd container
    When I open the web terminal
    And I run a condensed task glab auth command in the terminal and wait for completion
    Then the terminal output should visually match "glab-auth-host-detection"
