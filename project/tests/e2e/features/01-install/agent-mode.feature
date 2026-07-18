@e2e @agent-mode-only
Feature: Installing only the AI agent files (agent mode)
  As a developer trying out the DevSecOps Toolbox
  I want the installer to first ask whether to install everything, and to show
  a checklist when I say no
  So that I can pick only what I need today — the AI agent files
  (.agent/, CLAUDE.md, AGENTS.md) — without the rest of the framework

  # The choice is driven by the gum/glow menu layer. Say no to the full install
  # and a component list opens. With one component on offer it is a single-select
  # list, so pressing Enter takes the highlighted component — never the empty
  # "Nothing selected" trap a bare multi-select would spring on a lone item the
  # user never toggled.
  #
  # Storyboard contract: ONE sentence = ONE card = ONE pixel baseline, asserted
  # inside the step (tolerance: 0), so a visual regression fails on the exact
  # sentence whose image drifted. The storyboard SVG — copyable text around the
  # untouched frames, including the command that replays this scenario — is
  # assembled automatically when the scenario ends. The Given closes the
  # off-camera setup (test user, README project, cloned terminal, staged
  # installer, pre-installed tools) with its visual proof, and each Then pairs
  # its card with a check of the same fact (ls in the container, REST on the
  # remote branch) so a regression fails loud even without eyes.
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
