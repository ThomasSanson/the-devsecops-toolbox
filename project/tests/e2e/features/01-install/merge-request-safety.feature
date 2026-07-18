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
    Given a developer has cloned a project that already has a main branch
    When the installer finishes setup on the project that already had main
    Then a merge request into the existing main is now open on GitLab
    And GitLab lists main next to the init-framework-devsecops branch
    # Chapter: you started on an experiment branch
    Given a developer is working on an experiment branch instead of main
    When the installer finishes setup while on the experiment branch
    Then the new merge request targets main, not the experiment branch
    And GitLab shows only main and the framework branch, never the local experiment branch
    # Chapter: the opt-out you ask for on purpose
    Given a developer has set the installer to deliver straight to main
    When the installer finishes setup in direct-delivery mode
    Then GitLab shows main alone, with no review branch and no merge request
    And the project's main holds only the starter README
