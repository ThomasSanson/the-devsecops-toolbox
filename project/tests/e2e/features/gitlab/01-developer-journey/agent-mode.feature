@e2e @e2e-journey @e2e-journey-agent-mode
Feature: Developer journey — selective install (agent mode)
  As a developer adopting the DevSecOps Toolbox
  I want the installer to first ask whether to install everything, and to offer
  a component checklist when I decline
  So that I can pick only what I need — today, the AI agent guardrails
  (.agent/, CLAUDE.md, AGENTS.md) — without the rest of the framework

  # The selection is driven by the premium gum/glow UI layer (the same layer as
  # glab:auth:ensure). Declining the complete install opens a component list the
  # developer picks from. With one component on offer it is a single-select list,
  # so a developer who just presses Enter takes the highlighted component — never
  # the empty-handed "Nothing selected" trap a bare multi-select would spring on a
  # lone item the user never toggled.
  #
  # ONE storyboard SVG, the whole real journey in order, exactly as a developer
  # sees it: a two-column grid of uniform numbered cards. Each When line below
  # IS one numbered panel of the storyboard — the panel's title is the line's
  # own text (wired automatically by storyboardWhen), so the scenario and the
  # image can never drift apart, and every title, note and reproduce command
  # around the frames is selectable text (SVG) a reader can copy — including
  # the command that replays this very scenario, printed in the header. Every frame is a genuine capture taken at
  # its instant (gum menus erase themselves on answer, and the GitLab panels
  # live on another page) and is asserted against its OWN pixel baseline; the
  # toolchain check is pre-installed off-camera and dropped as noise. The local
  # AND the remote outcomes are then asserted programmatically.
  @e2e-journey-agent-mode-only
  Scenario: Declining the full framework installs only the AI agent guardrails
    Given a GitLab runs in a container configured with user "lambda"
    And a fresh Ubuntu web terminal cloned from a GitLab project that already has a main branch
    And the working-branch installer is staged in the terminal
    And the toolchain is already installed

    When the developer opens the fresh project on GitLab
    And the developer checks out the cloned project in the terminal
    And the developer launches the installer and chooses to pick components
    And the developer takes the agent component from the checklist
    And the installer delivers only the AI agent guardrails
    And the developer pushes the guardrails to main
    And the developer reviews the guardrails on GitLab main

    # The working tree carries ONLY the AI agent context — asserted first so a
    # regression (the "Nothing selected" trap) fails loud and fast.
    Then the project working tree should contain only the AI agent context files

    # ONE storyboard (SVG in storyboards/, frames baselined per step under
    # this directory): each When line above is its titled, numbered panel.
    And every step of the journey should visually match its baseline frame in "gitlab/01-developer-journey/agent-mode"

    # The GitLab hook: the guardrails reached the REMOTE main branch — proven
    # server-side via the API, not just in the local working tree.
    And the branch "main" must contain the file ".agent" for the journey project
    And the branch "main" must contain the file "AGENTS.md" for the journey project
    And the branch "main" must contain the file "CLAUDE.md" for the journey project
