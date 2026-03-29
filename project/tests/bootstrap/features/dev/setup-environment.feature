@bootstrap @dev @bootstrap-dev-setup-environment
Feature: Dev Environment Setup DX
  As a first-time toolbox user
  I want to setup the complete environment at once
  So that all my CLI tools are installed gracefully

  @ubuntu @ttyd
  Scenario: Setup all dependencies
    Given a generated toolbox project is mounted in a fresh Ubuntu ttyd container
    When I open the web terminal
    And I type "task dev:setup-environment" in the terminal and wait for completion
    And I run "task dev:setup-environment 2>&1 | tail -10" from "/workspace" in the ttyd container
    And the command output is displayed in the browser
    Then the terminal output should visually match "dev-setup-environment-success"
