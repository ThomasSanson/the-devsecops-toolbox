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
  Scenario: Declining the full framework installs only the AI agent guardrails
    Given a fresh GitLab project with only a README on its main branch
    When the developer checks out the cloned project in the terminal
    And the developer launches the installer and chooses to pick components
    And the developer takes the agent component from the checklist
    And the installer delivers only the AI agent guardrails
    Then the working tree carries only the AI agent context files
    When the developer pushes the guardrails to main
    Then the guardrails are live on the project's main page
    And the shipped .agent tree is browsable on GitLab main
