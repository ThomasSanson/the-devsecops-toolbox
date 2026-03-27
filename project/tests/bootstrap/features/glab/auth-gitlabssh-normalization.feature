@bootstrap @glab @bootstrap-glab-auth-gitlabssh
Feature: Bootstrap glab gitlabssh hostname normalization
  As a toolbox user on a forge with a separate SSH hostname
  I want gitlabssh hostnames to be normalized to gitlab
  So that glab commands target the correct API host

  @ubuntu @ttyd
  Scenario: task glab:auth:status normalizes gitlabssh remote to gitlab hostname
    Given a generated toolbox project with git remote "git@gitlabssh.example.com:org/project.git" is mounted in a fresh Ubuntu ttyd container
    When I open the web terminal
    And I run a condensed task glab auth status check in the terminal and wait for completion
    Then the terminal output should visually match "glab-auth-gitlabssh-normalization"
