Feature: GitLab Auth Ensure DX

  As a developer initializing the DevSecOps Toolbox
  I want a premium interactive terminal UI if GitLab auth is missing
  So that I am guided gracefully to authenticate and resume bootstrap

  @bootstrap-glab-auth-ensure
  Scenario: Interactive authentication declined
    Given a generated toolbox project is mounted in a fresh Ubuntu ttyd container
    And I open the web terminal
    When I type "export PATH=$HOME/.local/bin:$PATH; task glab:auth:ensure" in the terminal
    Then the terminal output should visually match "glab-auth-ensure-prompt"
    When I type "n" in the terminal
    Then the terminal output should visually match "glab-auth-ensure-declined"

  @bootstrap-glab-auth-ensure
  Scenario: Authentication fast-fail in CI mode
    Given a generated toolbox project is mounted in a fresh Ubuntu ttyd container
    And I open the web terminal
    When I type "export PATH=$HOME/.local/bin:$PATH; CI=true task glab:auth:ensure" in the terminal and wait for completion
    Then the terminal output should visually match "glab-auth-ensure-ci-fail"

  @bootstrap-glab-auth-ensure
  Scenario: Missing glab binary
    Given a generated toolbox project is mounted in a fresh Ubuntu ttyd container
    And I open the web terminal
    # Temporarily hide glab binary
    When I type "mv ~/.local/bin/glab ~/.local/bin/glab.bak" in the terminal and wait for completion
    And I type "export PATH=$HOME/.local/bin:$PATH; task glab:auth:ensure" in the terminal and wait for completion
    Then the terminal output should visually match "glab-auth-ensure-missing-bin"
    # Restore glab
    And I type "mv ~/.local/bin/glab.bak ~/.local/bin/glab" in the terminal and wait for completion
