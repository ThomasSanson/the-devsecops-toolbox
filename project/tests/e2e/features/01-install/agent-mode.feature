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
  # shows the whole run since the typed command; gum erases a menu the moment it
  # is answered, so each menu is caught live, before its answer. The Given closes
  # the off-camera setup (test user, README project, its clone, staged
  # installer, pre-installed tools) with its visual proof, and every card is
  # paired with a check of the same fact (the screen, the install log and the
  # working tree in the container, REST on the remote branch), so a regression
  # fails loud even without eyes.
  @agent-mode-only
  Scenario: Saying no to the full framework installs only the AI agent files
    # Note: GitLab's page for the main branch of a brand-new project. The Files panel on the left lists one file, README.md, and the table shows it on the commit "Initial commit".
    # Note: The project's random name shows as "project", and dates and avatars are hidden, so the picture is the same on every run.
    # Copy: http://gitlab/<lambda-user>/<project>/-/tree/main
    Given a fresh GitLab project with only a README on its main branch
    # Note: The terminal, from the typed installer command down. The installer lists its two choices, "Complete framework" and "Choose components", then asks "Install the complete DevSecOps framework?".
    # Note: The developer has moved to the answer "Choose components", the highlighted button, and is about to press Enter.
    # Copy: curl -fsSL https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/raw/main/.config/devsecops/install.sh -o /tmp/devsecops-install.sh && bash /tmp/devsecops-install.sh
    When the developer starts the installer and picks "Choose components" instead of the complete framework
    # Note: The same terminal once that answer is given. The question is gone, and a checklist headed "Select what to install" takes its place.
    # Note: Its first line, "✓ Agent mode", is already ticked, and "Source publication" below it is not.
    Then a checklist opens with the AI agent line already ticked
    # Note: The developer presses Enter on the checklist as it is, and the checklist clears itself. The installer then says "Agent mode installed." and "Installed the AI agent context: .agent/, CLAUDE.md, AGENTS.md.", and gives the prompt back.
    And once the developer confirms the ticked line, the installer installs only the AI agent files
    # Note: Agent mode leaves the commit to the developer. The same terminal, cleared, then one typed line: it adds the new files, commits them as "chore: install the AI agent guardrails" and pushes them to the main branch on GitLab.
    # Note: Git answers "Your branch is up to date with 'origin/main'." and "nothing to commit, working tree clean": everything is on GitLab now.
    # Copy: git add -A && git commit -q -m "chore: install the AI agent guardrails" && git push -q origin main && git status
    When the developer commits the new files and pushes them to the main branch
    # Note: The same GitLab page as the first card. The table now lists .agent, AGENTS.md and CLAUDE.md on the commit "chore: install the AI agent guardrails", and README.md is still on "Initial commit".
    # Note: The Files panel opens .agent to show the rules and skills it holds.
    Then GitLab shows the AI agent files beside the README on the main branch, and nothing else
