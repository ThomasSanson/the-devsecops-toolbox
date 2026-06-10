@e2e @e2e-journey @e2e-journey-blank-repo
Feature: Developer journey — onboarding starts from a blank repository
  As a developer adopting the DevSecOps Toolbox
  I want to clone my own empty project from GitLab into a real terminal
  So that the installer scaffolds the whole project from scratch in front of me

  @e2e-journey-blank-repo-terminal
  Scenario: The freshly cloned project shows an empty working tree in a real terminal
    Given a GitLab runs in a container configured with user "lambda"
    And a fresh Ubuntu web terminal cloned from a freshly created blank GitLab project
    When I display the cloned project state in the terminal
    Then the developer terminal should visually match "gitlab/01-developer-journey/blank-repo-terminal"
