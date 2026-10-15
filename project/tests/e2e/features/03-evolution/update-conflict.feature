@e2e
Feature: A toolbox release changes a line I edited myself, and the update merge request shows both
  As a maintainer of a project generated from the DevSecOps Toolbox
  I want `task devsecops:update` to tell me when a new release changes a line of
  a framework file I had edited myself, instead of silently dropping either change
  So that I settle the clash on purpose, in a review, and keep my own intent.

  # A separate story from @toolbox-update on purpose: that one proves the update
  # keeps my work when the release and I touch different things. This one proves
  # what happens when we touch the SAME line of a framework file, here the CI
  # image of .gitlab-ci.yml, a file the toolbox owns and updates.
  #
  # ONE Gherkin sentence = ONE card = ONE pixel baseline, asserted inside the
  # step (tolerance: 0). A real GitLab project of the test user, generated from
  # release 1.0.0 of a two-release template and pushed off camera; the real
  # `task devsecops:update` in a live terminal, with copier's default conflict
  # mode (markers in the file, no .rej file); then the merge request it opened,
  # before and after the developer settles the clash, shot from the SAME page.
  # Every card is paired with a check of the same fact (REST on GitLab, the
  # working tree in the container), so a regression fails loud even without eyes.
  @toolbox-update-conflict
  Scenario: a toolbox update collides with my edit on a framework file, and I settle it in the merge request
    # Chapter: My edit and the release touch the same line
    # Note: The project came from toolbox release 1.0.0, whose .gitlab-ci.yml runs every pipeline in the toolbox image tagged 1.0.0. The developer swapped that tag for their own build, 1.0.0-hardened, and pushed the commit to the main branch.
    # Note: GitLab's page for that commit, "ci: pin our hardened image": the red line is the tag the release wrote, the green line is the developer's.
    # Copy: sed -i 's/:1.0.0$/:1.0.0-hardened/' .gitlab-ci.yml && git commit -qam "ci: pin our hardened image" && git push -q
    Given the developer swapped the toolbox's CI image for their own hardened tag on the main branch
    # Note: Release 1.0.1 is out, and it moves the same image line to the tag 1.0.1. The developer asks for it with one command, from the main branch.
    # Note: Copier applies the release, then a warning names .gitlab-ci.yml: "this release changed lines you had edited too". The update still pushes the branch update-framework-devsecops and opens merge request !1 into the main branch.
    # Copy: task devsecops:update
    When the developer runs the toolbox update and it warns that the release changes the same line
    # Chapter: The merge request shows the clash, and the developer settles it
    # Note: The Changes tab of merge request !1. The answers file moves from 1.0.0 to 1.0.1, and .gitlab-ci.yml keeps both image lines between conflict markers: the developer's 1.0.0-hardened under "<<<<<<< before updating", the release's 1.0.1 above ">>>>>>> after updating".
    # Note: Nothing was dropped, and the main branch did not move.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1/diffs
    Then GitLab now holds an update merge request showing both image lines as a conflict
    # Note: On the update branch, the developer replaces the whole conflict with one line, their hardening on the new release (1.0.1-hardened), then commits and pushes it.
    # Note: The same tab now shows one plain change, from 1.0.0-hardened to 1.0.1-hardened, with no marker left. Commits counts 2, the update and the fix, ready for review.
    # Copy: sed -i '/^<<<<<<< /,/^>>>>>>> /c image: registry.gitlab.com/digital-commons/devsecops/the-devsecops-toolbox:1.0.1-hardened' .gitlab-ci.yml && git commit -qam "ci: keep our hardened image on 1.0.1" && git push -q
    And once the developer fixes that line on the update branch, the merge request carries their hardened tag on the new release

  # A second story on the same promise, for the release that moves the AI agent
  # files from .agent/ to .agents/. A move is where an update loses work most
  # easily: the team's own rule and its edit to a toolbox rule live in the old
  # folder. Release 1.0.0 of a two-release template keeps the old folder;
  # release 1.0.1 is today's layout, plus one line in two toolbox rules the team
  # never touched. The release's migration moves the files one by one before
  # copier merges, so those two rules come through clean and only the team's
  # edit is left to settle. CI is switched off for this project: no pipeline
  # repaints its pages.
  @agents-move
  Scenario: a toolbox update moves the AI agent files to .agents and keeps the team's own work
    # Chapter: The team's work sits in the old .agent folder
    # Note: The project came from toolbox release 1.0.0, which kept the AI agent files in a folder named .agent, without the s. The developer adds a rule of the team's own, .agent/rules/our-team.md, and one line to a toolbox rule, .agent/rules/stability.md, then pushes the commit to the main branch.
    # Note: GitLab's page for that commit, "docs: add our own rules for the AI agents": the new file and the added line, in green.
    # Copy: printf '# Our team rule\n\nRun the e2e suite before every merge request.\n' > .agent/rules/our-team.md && echo 'Our CI images are built in project/ci, never in .config.' >> .agent/rules/stability.md && git add -A && git commit -qm "docs: add our own rules for the AI agents" && git push -q
    Given the team added a rule of its own and a line to a toolbox rule in the old .agent folder, on the main branch
    # Chapter: The release moves the folder, and only the team's edit is left to settle
    # Note: Release 1.0.1 moves the AI agent files to .agents, the folder AI tools read today, and adds a line to two toolbox rules the team never touched. The developer asks for it with one command, from the main branch.
    # Note: Copier first runs the release's migration, migrate-agents.sh: a toolbox file the team never changed is removed, so the release writes it fresh in .agents, and every other file moves there with git. One warning follows, for .agents/rules/stability.md and no other file. The update then opens merge request !1.
    # Copy: task devsecops:update
    When the developer runs the toolbox update to the release that moves the AI agent files to .agents
    # Note: GitLab's page for the update branch, update-framework-devsecops, the Files panel open on .agents and its rules: our-team.md moved there, next to the toolbox rules.
    # Note: The table lists .agents and .claude/skills, and no .agent folder is left. .agents holds rules and skills only: the eight step-by-step guides of release 1.0.0 came back as skills.
    Then GitLab shows the team's rule in .agents/rules on the update branch, and no .agent folder left
    # Note: The page of .agents/rules/stability.md on the update branch, the conflict highlighted. The release did not change this rule, it moved it, so Copier cannot tell the team's line from the toolbox's copy.
    # Note: The team's line waits under "<<<<<<< before updating", for the developer to keep or drop before merging. Nothing was lost.
    And the team's line in that toolbox rule waits between conflict markers in the rule's new place
