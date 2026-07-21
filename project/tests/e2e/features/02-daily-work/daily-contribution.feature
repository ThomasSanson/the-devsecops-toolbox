@e2e
Feature: An everyday change goes from an issue to a released version
  As a developer working on a project the toolbox already set up
  I want to open an issue, carry the change through a merge request, and see
  main release it on its own
  So that the daily contribution loop is proven end to end, from ticket to tag.

  # ONE story, its own shard: a project that already ran the installer gets one
  # small everyday change. It starts as an issue, rides a merge request with its
  # own branch, its pipeline goes green, it merges into main, and main's own
  # pipeline stamps the next version — no manual release. ONE Gherkin sentence =
  # ONE card = ONE pixel baseline, asserted inside the step (tolerance: 0). GitLab
  # pages are shown whole and masked (dates, avatars, ids, durations, SHAs are
  # volatile); each terminal card is a real <pre> of the command output; every
  # card twins its frame with a REST/git check of the same fact. A project-scoped
  # runner runs the real pipelines; it is registered and torn down for this story
  # alone.
  #
  # Chapter 1 opens the work as an issue and a merge request created from it.
  # Chapter 2 carries the change on its branch and turns the merge request green.
  # Chapter 3 merges into main and lets the release stamp the new version.
  @daily-contribution
  Scenario: An issue becomes a merge request, and main releases the change
    # Chapter: An issue starts the work
    # Note: A project that already ran the installer: main carries the whole framework, with its automation token wired so the release can run on its own. This is where a new day of work begins.
    # Copy: http://gitlab/<lambda-user>/<project>
    Given an installed project with the framework already on its main branch
    # Note: An issue is a ticket describing the work. This one asks for a short line in the README. Opening it first is how a change starts here.
    # Copy: http://gitlab/<lambda-user>/<project>/-/issues/1
    When the developer opens an issue for a small change
    # Note: A merge request (the page where a change is reviewed before joining main) is created straight from the issue, together with the branch that will carry the work.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    Then a merge request opens from the issue, with its own branch
    # Chapter: The change rides a merge request
    # Note: The developer switches to the new branch and adds one line to the README. This is the everyday change the whole story is about.
    # Copy: git checkout 1-mention-the-toolbox-in-the-readme
    When the developer checks out the branch and edits the README
    # Note: The commit message follows Conventional Commits (feat: a new feature), so the release tooling can turn it into the next version later.
    # Copy: git commit -m "feat: mention the toolbox in the readme"
    And the developer commits the change as a conventional feat
    # Note: Pushing the branch updates the merge request and starts its pipeline (the automatic checks that must pass before the change can merge).
    # Copy: git push
    And the developer pushes the branch to GitLab
    # Note: The full inherited pipeline runs on the change and every job passes. Main only accepts a change once these checks are green.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1/pipelines
    Then the merge request's pipeline turns green
    # Chapter: Main releases it
    # Note: With the pipeline green, the merge request is merged. The branch joins main through review, never a forced push.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    When the reviewed change merges into main
    # Note: The merge starts main's own pipeline; its release job reads the feat commit and stamps the next version. The tags page now shows 0.2.0 — plain, with no v in front.
    # Copy: http://gitlab/<lambda-user>/<project>/-/tags
    Then main's pipeline stamps the next version tag
    # Note: The release wrote the change into the repository: the README now carries the developer's line and VERSION reads 0.2.0. The everyday contribution is proven end to end.
    # Copy: http://gitlab/<lambda-user>/<project>
    And the new version now lives in the files on main
