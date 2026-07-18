@e2e @self-healing
Feature: init repairs its own GitLab connection when something breaks it
  As a maintainer relying on the toolbox
  I want `task devsecops:init` to be the one command that fixes its own GitLab
  setup — the project access token, the CI/CD variable, and the branch it
  authenticates against — no matter what damage happened behind its back
  So that running it again always leaves one working, matching credential in place.

  # ONE story in two chapters, each on its OWN fresh project. ONE Gherkin
  # sentence = ONE card = ONE pixel baseline, asserted inside the step
  # (tolerance: 0). An automation token is the credential the framework uses to
  # act on GitLab; a CI/CD variable holds its value for the pipeline. Each Then
  # twins its GitLab page or terminal frame with a REST check of the SAME fact,
  # so a regression fails loud even without eyes. Dates and secrets that change
  # every run are masked.
  #
  # Chapter 1 — the token is revoked behind init's back: init re-creates it, the
  # CI/CD variable follows, the healed token really clones the repository, and a
  # second run changes nothing. Chapter 2 — the other two break modes: a
  # tampered CI/CD variable and a planted duplicate token are both repaired.
  Scenario: init heals a revoked token, a tampered variable and a duplicate token
    # Chapter: A revoked token is rebuilt
    Given a project the framework has already set up with its automation token
    When the developer revokes the automation token behind the framework's back
    And the developer runs the framework's init again
    Then GitLab now holds a brand-new automation token
    And GitLab's CI/CD variable now matches the new token
    And the healed token clones the repository over HTTPS
    When the developer runs init a second time
    Then the second run leaves the healed token untouched
    # Chapter: A tampered variable and a duplicate token are repaired
    Given a project the framework already set up and is healthy
    When a duplicate automation token is planted behind the framework's back
    And the CI/CD variable is overwritten with a bad value
    And the developer runs the framework's init once more
    Then only one automation token survives the purge
    And the healed CI/CD variable clones the repository again
