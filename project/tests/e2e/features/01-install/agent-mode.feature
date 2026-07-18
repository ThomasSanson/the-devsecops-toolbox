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
    # Note: The empty project after cloning: a README and nothing else. Changing details (dates, avatars, project name) are hidden so the picture is always the same.
    # Copy: http://gitlab/<lambda-user>/<project>
    Given a fresh GitLab project with only a README on its main branch
    # Note: A new terminal window: the copy has only the README, and git shows no changes.
    # Copy: ls -A1 && git status
    When the developer opens the cloned project in the terminal
    # Note: The installer asks whether to install everything; the cursor is moved onto "Choose components" before answering.
    # Copy: bash /tmp/devsecops-install.sh
    And the developer starts the installer and chooses to pick what to install
    # Note: A single-choice list: pressing Enter picks the highlighted AI agent option, so you never end up with nothing selected.
    And the developer picks the AI agent option from the checklist
    # Note: The installer confirms what it installed: the AI agent files only.
    And the installer installs only the AI agent files
    # Note: The project folder now: .agent/, CLAUDE.md, AGENTS.md — and none of the rest of the framework.
    # Copy: ls -A1 && tree -a -I '.git'
    Then the project folder now holds only the AI agent files
    # Note: Agent mode pushes straight to the main branch, with no merge request to review first; GitLab now lists the AI agent files.
    # Copy: git add -A && git commit -q -m "chore: install the AI agent guardrails" && git push -q origin main
    When the developer pushes the AI agent files to main
    # Note: The same project page now shows the AI agent files on main, in the commit "chore: install the AI agent guardrails".
    # Copy: http://gitlab/<lambda-user>/<project>
    Then the AI agent files are live on the project's main page
    # Note: Inside the .agent folder: the rules, skills and workflows agent mode installed.
    # Copy: http://gitlab/<lambda-user>/<project>/-/tree/main/.agent
    And the .agent folder can now be opened on GitLab
