@e2e @e2e-journey @e2e-journey-agent-mode
Feature: Developer journey — installing only the AI agent files (agent mode)
  As a developer adopting the DevSecOps Toolbox
  I want the installer to first ask whether to install everything, and to show
  a checklist when I say no
  So that I can pick only what I need — today, the AI agent files
  (.agent/, CLAUDE.md, AGENTS.md) — without the rest of the framework

  # The selection is driven by the premium gum/glow UI layer (the same layer as
  # glab:auth:ensure). Declining the complete install opens a component list the
  # developer picks from. With one component on offer it is a single-select list,
  # so a developer who just presses Enter takes the highlighted component — never
  # the empty-handed "Nothing selected" trap a bare multi-select would spring on a
  # lone item the user never toggled.
  #
  # ONE sentence = ONE storyboard card = ONE pixel baseline, asserted inside the
  # step itself (tolerance: 0): a visual regression fails on the exact sentence
  # whose image drifted. The storyboard SVG — selectable, copyable text around
  # the untouched frames, including the command that replays this very scenario —
  # is assembled automatically when the scenario ends. The Given closes the
  # off-camera stage (lambda user, README project, cloned terminal, staged
  # installer, pre-installed toolchain) with its visual proof, and each Then
  # pairs its card with a programmatic assert of the same fact (ls in the
  # container, REST on the remote branch) so a regression fails loud even
  # without eyes.
  @e2e-journey-agent-mode-only
  Scenario: Saying no to the full framework installs only the AI agent files
    Given a fresh GitLab project with only a README on its main branch
    When the developer opens the cloned project in the terminal
    And the developer starts the installer and chooses to pick what to install
    And the developer picks the AI agent option from the checklist
    And the installer installs only the AI agent files
    Then the project folder now holds only the AI agent files
    When the developer pushes the AI agent files to main
    Then the AI agent files are live on the project's main page
    And the .agent folder can now be opened on GitLab
