@bootstrap @glab @bootstrap-glab-auth-ensure
Feature: DevSecOps Init UI Dependencies Missing
  As a DevSecOps engineer
  I want a fast-fail error when premium UI dependencies (gum/glow) are missing
  So that I know how to recover

  @ubuntu @ttyd
  Scenario: Missing UI dependency gum shows fast-fail error
    Given a generated toolbox project is mounted in a fresh Ubuntu ttyd container
    And I open the web terminal
    When I type "mkdir -p ~/.local/bin && touch ~/.local/bin/glab && chmod +x ~/.local/bin/glab" in the terminal and wait for completion
    And I type "task glab:auth:ensure" in the terminal and wait for completion
    Then the terminal output should visually match "devsecops-init-missing-gum"

  @ubuntu @ttyd
  Scenario: Missing UI dependency glow shows fast-fail error
    Given a generated toolbox project is mounted in a fresh Ubuntu ttyd container
    And I open the web terminal
    When I type "mkdir -p ~/.local/bin && touch ~/.local/bin/glab && chmod +x ~/.local/bin/glab && touch ~/.local/bin/gum && chmod +x ~/.local/bin/gum" in the terminal and wait for completion
    And I type "task glab:auth:ensure" in the terminal and wait for completion
    Then the terminal output should visually match "devsecops-init-missing-glow"
