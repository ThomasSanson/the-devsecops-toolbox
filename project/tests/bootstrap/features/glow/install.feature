@bootstrap @glow @bootstrap-glow-install
Feature: Glow Installation DX
  As a first-time toolbox user
  I want standalone glow installation to show clear visual feedback
  So that I know the markdown reader is ready

  @ubuntu @ttyd
  Scenario: Standalone glow install
    Given a generated toolbox project is mounted in a fresh Ubuntu ttyd container
    When I open the web terminal
    And I type "task glow:install" in the terminal and wait for completion
    Then the terminal output should visually match "glow-install-success"
