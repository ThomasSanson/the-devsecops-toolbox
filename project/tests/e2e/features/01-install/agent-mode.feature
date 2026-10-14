@e2e
Feature: Installing only the AI agent files (agent mode)
  As a developer trying out the DevSecOps Toolbox
  I want the installer to first ask whether to install everything, and to show
  a checklist when I say no
  So that I can pick only what I need today, the AI agent files
  (.agent/, CLAUDE.md, AGENTS.md), without the rest of the framework

  # The choice is driven by the gum/glow menu layer. Say no to the full install
  # and a checklist opens, one line per component. The first line starts already
  # ticked, so a plain Enter always installs something, never the empty "Nothing
  # selected" trap a checklist springs on items the user never toggled.
  #
  # Storyboard contract: ONE sentence = ONE card = ONE pixel baseline, asserted
  # inside the step (tolerance: 0), so a visual regression fails on the exact
  # sentence whose image drifted. GitLab opens and closes the story on the SAME
  # page at the SAME size: the repository page of the main branch, before and
  # after. The terminal in between is one tall session, and each terminal card
  # shows the whole run since the typed command. The Given closes the off-camera
  # setup (test user, README project, its clone, staged installer, pre-installed
  # tools) with its visual proof, and every card is paired with a check of the
  # same fact (the install log and the working tree in the container, REST on
  # the remote branch), so a regression fails loud even without eyes.
  @agent-mode-only
  Scenario: Saying no to the full framework installs only the AI agent files
    # Note: GitLab's page for the main branch of a brand-new project. The Files panel on the left lists one file, README.md, and the table shows it on the commit "Initial commit".
    # Note: Dates, avatars and the project's random name are hidden, so the picture is the same on every run.
    # Copy: http://gitlab/<lambda-user>/<project>/-/tree/main
    Given a fresh GitLab project with only a README on its main branch
    # Note: The terminal, from the typed installer command down. The installer explains its two choices, "Complete framework" and "Pick components". The developer turns down the complete framework, the yes/no question clears itself, and a checklist opens.
    # Note: Its first line, "Agent mode", is already ticked, so pressing Enter installs the AI agent files and nothing else.
    # Copy: bash /tmp/devsecops-install.sh
    When the developer starts the installer and turns down the complete framework, a checklist opens with the AI agent line already ticked
    # Note: The same terminal once the install is over. The installer says "Agent mode installed." and "Installed the AI agent context: .agent/, CLAUDE.md, AGENTS.md.", then gives the prompt back.
    Then the installer installs only the AI agent files
    # Note: The same GitLab page as the first card, after one push to the main branch. The table now lists .agent, AGENTS.md and CLAUDE.md on the commit "chore: install the AI agent guardrails", and README.md is still on "Initial commit".
    # Note: The Files panel opens .agent to show the rules and skills it holds. Agent mode pushes straight to the main branch, with no merge request.
    # Copy: git add -A && git commit -q -m "chore: install the AI agent guardrails" && git push -q origin main
    And after one push to the main branch, GitLab shows the AI agent files beside the README and nothing else
