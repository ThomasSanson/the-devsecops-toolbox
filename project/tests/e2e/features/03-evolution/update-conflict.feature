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
    # Note: GitLab's page for that commit: the red line is the tag the release wrote, the green line is the developer's.
    # Copy: sed -i 's/:1.0.0$/:1.0.0-hardened/' .gitlab-ci.yml && git commit -qam "ci: pin our hardened image" && git push -q
    Given the developer swapped the toolbox's CI image for their own hardened tag on the main branch
    # Note: Release 1.0.1 is out, and it moves the same image line to the tag 1.0.1. The developer asks for it with one command, from the main branch.
    # Note: The update cannot keep both lines, so it names the file that needs a decision, .gitlab-ci.yml, then pushes the update branch and opens the merge request anyway.
    # Copy: task devsecops:update
    When the developer runs the toolbox update and it warns that the release changes the same line
    # Chapter: The merge request shows the clash, and the developer settles it
    # Note: The Changes tab of the merge request the update opened. In .gitlab-ci.yml both image lines are there, between conflict markers: the developer's 1.0.0-hardened under "before updating", the release's 1.0.1 under "after updating".
    # Note: Nothing was dropped, and nothing reached the main branch.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1/diffs
    Then GitLab now holds an update merge request showing both image lines as a conflict
    # Note: On the update branch, the developer replaces the whole conflict with one line, their hardening on the new release (1.0.1-hardened), then commits and pushes it.
    # Note: The same tab now shows a plain change from 1.0.0-hardened to 1.0.1-hardened, with no markers left: the merge request is ready for review.
    # Copy: sed -i '/^<<<<<<< /,/^>>>>>>> /c image: registry.gitlab.com/digital-commons/devsecops/the-devsecops-toolbox:1.0.1-hardened' .gitlab-ci.yml && git commit -qam "ci: keep our hardened image on 1.0.1" && git push -q
    And once the developer fixes that line on the update branch, the merge request carries their hardened tag on the new release
