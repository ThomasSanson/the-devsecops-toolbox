@bootstrap @glab @bootstrap-glab-auth-status-host-scope
Feature: Bootstrap glab auth status host scoping
  As a toolbox user
  I want glab authentication checks to target the repository host
  So that an unrelated broken glab host does not block my workflow

  @ubuntu @ttyd
  Scenario: task glab:auth:status succeeds with repository host even when another host fails
    Given the GitLab test stack is started with docker compose
    And a generated toolbox project is mounted in a fresh Ubuntu ttyd container with extra packages "git unzip"
    And the ttyd project is connected to the GitLab test network with a valid glab login
    And the ttyd glab config contains a failing secondary host
    And glab is available in the ttyd container shell
    And glab host-specific statuses include one healthy and one failing host in ttyd
    When I open the web terminal
    And I run a condensed glab auth status report in the terminal and wait for completion
    Then the terminal output should visually match "glab-auth-status-multi-host"
    When I run a condensed task glab auth status check in the terminal and wait for completion
    And task glab auth status succeeds in ttyd
    Then the terminal output should visually match "glab-auth-status-host-scoped"
