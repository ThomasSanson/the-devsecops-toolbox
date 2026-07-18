@e2e @merge-request-safety
Feature: init always delivers the framework through a review you can see
  As a developer setting up the DevSecOps Toolbox
  I want init to reach main through a merge request I can review
  So that the framework never lands on main without a review, unless I clearly ask for it

  # ONE story in three chapters, each in its OWN fresh project (they never
  # share state). A merge request is the page where changes get reviewed before
  # joining main. ONE Gherkin sentence = ONE card = ONE pixel baseline, asserted
  # inside the step (tolerance: 0); each Then twins its page or terminal frame
  # with a REST check of the same fact, so a regression fails loud even without
  # eyes. GitLab pages are masked (dates, names, avatars) so they render the
  # same every run.
  #
  # Chapter 1 — main already exists: init still branches off it and opens the
  # review, never pushing to main. Chapter 2 — you started on a throwaway
  # experiment branch: init branches from main, not from where you happen to
  # stand, and never pushes the local experiment. Chapter 3 — the opt-out you
  # ask for on purpose (TASK_DEVSECOPS_INIT_DIRECT=true): the starter README
  # goes straight to main, no branch and no merge request.
  Scenario: init routes through a review from any branch, and steps aside only when you opt out
    # Chapter: main already exists
    # Note: The cloned copy of a project that already has main: git shows main as the current branch before the installer runs.
    # Copy: git branch -a
    Given a developer has cloned a project that already has a main branch
    # Note: The installer finishes on the existing main; the finished screen still names the init-framework-devsecops merge request.
    When the installer finishes setup on the project that already had main
    # Note: The merge request from init-framework-devsecops into the main that was already there — a review, not a forced push.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    Then a merge request into the existing main is now open on GitLab
    # Note: The branches page: the main that was already there, and the framework branch made from it.
    # Copy: http://gitlab/<lambda-user>/<project>/-/branches
    And GitLab lists main next to the init-framework-devsecops branch
    # Chapter: you started on an experiment branch
    # Note: The cloned copy switched to a throwaway experiment branch named spike/poc: git shows it as current, main still there, before the installer runs.
    # Copy: git checkout -b spike/poc && git branch
    Given a developer is working on an experiment branch instead of main
    # Note: The installer finishes while the developer is still on spike/poc; the finished screen still names the merge request.
    When the installer finishes setup while on the experiment branch
    # Note: The merge request aims at main; its branch grew from main, never from the throwaway spike/poc branch.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    Then the new merge request targets main, not the experiment branch
    # Note: The branches page holds main and init-framework-devsecops only; the local spike/poc was never pushed.
    # Copy: http://gitlab/<lambda-user>/<project>/-/branches
    And GitLab shows only main and the framework branch, never the local experiment branch
    # Chapter: the opt-out you ask for on purpose
    # Note: The freshly cloned blank project, installer set to direct-delivery mode — git shows no commits yet before it runs.
    # Copy: git status
    Given a developer has set the installer to deliver straight to main
    # Note: The installer finishes in direct-delivery mode; it names no merge request, because the changes go straight to main.
    When the installer finishes setup in direct-delivery mode
    # Note: The branches page shows main by itself: no framework branch and no merge request, because you asked for direct delivery.
    # Copy: http://gitlab/<lambda-user>/<project>/-/branches
    Then GitLab shows main alone, with no review branch and no merge request
    # Note: The project home page: main holds just the starter README; the framework stays in the local copy on disk.
    # Copy: http://gitlab/<lambda-user>/<project>
    And the project's main holds only the starter README
