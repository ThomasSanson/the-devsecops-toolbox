@e2e
Feature: Installing only the AI agent files (agent mode)
  As a developer trying out the DevSecOps Toolbox
  I want the installer to first ask whether to install everything, and to show
  a checklist when I say no
  So that I can pick only what I need today, the AI agent files
  (.agents/, .claude/skills, CLAUDE.md, AGENTS.md), without the rest of the framework,
  and get them again later without losing my team's own rules

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
  # fails loud even without eyes. Two later chapters run the same installer again
  # on the same project: once on top of its own files, once on the old .agent
  # folder an earlier release installed, and end on the same GitLab page.
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
    # Note: The developer presses Enter on the checklist as it is, and the checklist clears itself. The installer then says "Agent mode installed." and "Installed the AI agent context: .agents/, CLAUDE.md, AGENTS.md.", and gives the prompt back.
    And once the developer confirms the ticked line, the installer installs only the AI agent files
    # Note: Agent mode leaves the commit to the developer. The same terminal, cleared, then one typed line: it adds the new files, commits them as "chore: install the AI agent guardrails" and pushes them to the main branch on GitLab.
    # Note: Git answers "Your branch is up to date with 'origin/main'." and "nothing to commit, working tree clean": everything is on GitLab now.
    # Copy: git add -A && git commit -q -m "chore: install the AI agent guardrails" && git push -q origin main && git status
    When the developer commits the new files and pushes them to the main branch
    # Note: The same GitLab page as the first card. The table now lists .agents, .claude/skills, AGENTS.md and CLAUDE.md on the commit "chore: install the AI agent guardrails", and README.md is still on "Initial commit".
    # Note: The Files panel opens .agents and its skills: fifteen of them, each a folder with its instructions. The .claude/skills row is where the AI tools that only look there find the same skills.
    Then GitLab shows the AI agent files beside the README on the main branch, and nothing else
    # Chapter: Installing again later
    # Note: Later, the developer runs the same installer again to get the latest AI agent files, with the same two answers. It says "Agent mode installed." as it did the first time.
    # Note: Right below, the developer types `ls -A1 .agents && git status`. The folder still holds only rules and skills, with no second .agents folder inside it, and git says "nothing to commit, working tree clean": the files are the ones already on the main branch.
    # Copy: bash /tmp/devsecops-install.sh
    When the developer runs the installer again later, git finds nothing to commit
    # Chapter: Moving from the old .agent folder
    # Note: Off camera, the project goes back to the way an earlier release of the toolbox installed it: a folder named .agent, without the s, holding the rules, the skills and eight step-by-step guides in .agent/workflows. The team has also added a rule of its own there, our-team.md, and pushed it to the main branch.
    # Note: GitLab's page for the main branch, the Files panel open on .agent, its rules and its workflows.
    Given the main branch still keeps the AI agent files in the old .agent folder, with a rule the team added
    # Note: The developer runs the installer once more, with the same answers. Then one typed line commits what it changed and pushes it to the main branch, and git ends on "nothing to commit, working tree clean".
    # Copy: git add -A && git commit -q -m "chore: move the AI files to .agents" && git push -q origin main && git status
    When the developer runs the installer over the old folder and pushes the result to the main branch
    # Note: The same GitLab page. The table lists .agents and .claude/skills, and no .agent folder is left. The Files panel opens .agents and its rules: our-team.md moved there, next to the toolbox rules.
    # Note: .agents holds rules and skills only. The eight guides are skills now, and no workflows folder came along.
    Then GitLab shows the team's rule in .agents/rules, and no .agent folder is left on the main branch
