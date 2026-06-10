@e2e @e2e-journey @e2e-journey-piped
Feature: The documented curl|bash install path stays interactive
  As a developer following the README
  I want `curl …/install.sh | bash` to keep the Copier questions interactive
  Even though the script's stdin is a pipe (the /dev/tty fallback)
  So that the documented one-liner actually works end to end

  @e2e-journey-piped-install
  Scenario: Piping the installer into bash completes the full onboarding
    Given a GitLab runs in a container configured with user "lambda"
    And a fresh Ubuntu web terminal cloned from a freshly created blank GitLab project
    And the working-branch installer is staged in piped mode in the terminal
    And glab is authenticated against the test GitLab

    When I run the working-branch installer to completion
    Then the install log should contain "Installation complete!"
    And the project should have a branch "init-framework-devsecops"
    And a merge request from "init-framework-devsecops" into "main" should be open for the project

    # The completion screen must be pixel-identical to the non-piped path —
    # per-variant baseline name (parallel workers never share actual paths).
    And the terminal from "Installation complete!" should visually match "gitlab/01-developer-journey/installation-complete-piped-terminal"
