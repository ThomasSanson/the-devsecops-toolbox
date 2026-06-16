@e2e @e2e-journey @e2e-journey-agent-mode
Feature: Developer journey — selective install via a component checklist
  As a developer adopting the DevSecOps Toolbox
  I want the installer to first ask whether to install everything, and offer a
  checklist of components when I decline
  So that I can pick only what I need — today, the AI agent guardrails
  (.agent/, CLAUDE.md, AGENTS.md) — without the rest of the framework

  # The selection is driven by the premium gum/glow UI layer (the same layer as
  # glab:auth:ensure). Declining the complete install opens a MULTI-SELECT
  # checklist (space to toggle, enter to confirm) — a single component today,
  # designed to grow (plan/code phases, etc.). The distinctive screens of this
  # flow are proven by real terminal baselines (tolerance:0); the shared prelude
  # (typed command, scope prompt) is already covered by the installer.feature
  # journey, so it is not re-captured here. The final working tree is asserted to
  # carry ONLY the agent context.
  @e2e-journey-agent-mode-only
  Scenario: Declining the full framework opens a component checklist and installs only the agent guardrails
    Given a GitLab runs in a container configured with user "lambda"
    And a fresh Ubuntu web terminal cloned from a freshly created blank GitLab project
    And the working-branch installer is staged in the terminal

    When I type the toolbox installer command in the terminal
    And I launch the installer and wait for the prompt "Install the complete DevSecOps framework?"
    And I decline installing the complete framework

    # The component checklist — a multi-select list (one component for now,
    # designed to grow). This is the distinctive screen of the selective flow.
    And I wait for the prompt "Select components to install"
    Then the terminal from "Select components to install" should visually match "gitlab/01-developer-journey/agent-mode-selection-terminal"

    # Checking the agent component renders only the AI agent guardrails
    When I select the agent component and wait for the installer to finish
    Then the terminal from "Installing agent mode" should visually match "gitlab/01-developer-journey/agent-mode-complete-terminal"

    # Final proof on the REAL cloned repo — git status shows the working tree
    # carries ONLY the AI agent context (.agent/, CLAUDE.md, AGENTS.md).
    # Symmetric with the blank-repo baseline that opened the journey.
    When I display the cloned project state in the terminal
    Then the developer terminal should visually match "gitlab/01-developer-journey/agent-mode-repository-terminal"

    # The actual content — a tree expands the .agent/ guardrails (rules/,
    # skills/, workflows/ and their files) alongside CLAUDE.md and AGENTS.md.
    When I display the project tree in the terminal
    Then the developer terminal should visually match "gitlab/01-developer-journey/agent-mode-tree-terminal"

    # Same fact asserted programmatically (.agent/, CLAUDE.md, AGENTS.md only)
    And the project working tree should contain only the AI agent context files
