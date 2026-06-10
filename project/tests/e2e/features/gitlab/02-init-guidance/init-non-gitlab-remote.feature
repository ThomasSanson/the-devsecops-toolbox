@e2e @e2e-init-guidance @e2e-init-remote-variants
Feature: init refuses to deliver onto a non-GitLab remote
  As a developer who cloned from another forge
  I want `task devsecops:init` to stop with remote-alignment guidance
  Instead of pushing the bootstrap commit to a foreign host
  So that nothing ever lands outside my GitLab project by accident

  @e2e-init-remote-non-gitlab
  Scenario: init guides the user to align a github.com remote
    Given a fresh Ubuntu environment with the toolbox is set up with git remote "https://github.com/acme/widgets.git"
    When I run the command "task devsecops:init" in the fresh Ubuntu environment
    Then the captured command should exit with a non-zero code
    And the captured output should contain "No GitLab repository remote was detected."
    And the captured output should contain "Align your repository remote, then rerun:"
    When the captured output is displayed in the browser
    Then the captured output should visually match "gitlab/02-init-guidance/non-gitlab-remote-terminal"
