@e2e
Feature: the framework repairs its own GitLab setup when something breaks it
  As a maintainer relying on the toolbox
  I want `task devsecops:init` to fix its own GitLab plumbing — the project
  access token, the CI/CD variable, the branch it authenticates against — no
  matter what damage happened behind its back, and `task devsecops:reload` to
  put a project that drifted back to what its own answers describe
  So that one command always leaves a working setup in place.

  # ONE story in three chapters, each on its OWN fresh project. ONE Gherkin
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
  # Chapter 3 — a project that drifted the way a live project does: someone
  # loosened the default branch in the GitLab settings, someone edited a
  # framework file in place, and the tokens are the ones from install day. A
  # single `task devsecops:reload` re-applies the project's own answers and
  # redoes the whole GitLab setup, tokens included — the difference with init,
  # which leaves a working token alone, is exactly what chapter 1 proves.
  @self-healing
  Scenario: init heals a revoked token, a tampered variable and a duplicate token, and reload puts a drifted project back
    # Chapter: A revoked token is rebuilt
    # Note: A fresh project after its first `task devsecops:init`: the access-tokens page shows the automation token init created.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/access_tokens
    Given a project the framework has already set up with its automation token
    # Note: The token is revoked from outside the framework, as if someone deleted it in GitLab: the access-tokens page no longer lists the automation token.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/access_tokens
    When the developer revokes the automation token behind the framework's back
    # Note: A single `task devsecops:init` re-run: the finishing message shows it noticed the token was missing and created a new one.
    # Copy: task devsecops:init
    And the developer runs the framework's init again
    # Note: The access-tokens page shows the automation token again, a different one from the token that was revoked.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/access_tokens
    Then GitLab now holds a brand-new automation token
    # Note: The CI/CD variables page shows the variable again, now pointing at the new token.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/ci_cd
    And GitLab's CI/CD variable now matches the new token
    # Note: The healed token signs in to GitLab and lists the repository over HTTPS (the secret and commit IDs are masked).
    # Copy: git clone http://<lambda-user>:<token>@gitlab/<lambda-user>/<project>.git
    And the healed token clones the repository over HTTPS
    # Note: A second `task devsecops:init` on the already-healed project: the finishing message reports the token is already in place, nothing to recreate.
    # Copy: task devsecops:init
    When the developer runs init a second time
    # Note: The access-tokens page has not changed: still one automation token. init does not quietly replace the token on every run.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/access_tokens
    Then the second run leaves the healed token untouched
    # Chapter: A tampered variable and a duplicate token are repaired
    # Note: A fresh project after its first `task devsecops:init`, working correctly: one automation token on the access-tokens page.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/access_tokens
    Given a project the framework already set up and is healthy
    # Note: A second token with the same name is created from outside the framework: the access-tokens page now lists two automation tokens where there should be one.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/access_tokens
    When a duplicate automation token is planted behind the framework's back
    # Note: The CI/CD variable is tampered with, its value replaced by a bad string that GitLab hides on screen: the CI/CD variables page still lists it.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/ci_cd
    And the CI/CD variable is overwritten with a bad value
    # Note: A single `task devsecops:init` re-run: the finishing message shows it removed the duplicate token and put the CI/CD variable back.
    # Copy: task devsecops:init
    And the developer runs the framework's init once more
    # Note: The access-tokens page is back to a single automation token — the duplicate is gone.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/access_tokens
    Then only one automation token survives the purge
    # Note: The variable no longer carries the bad value: it signs in to GitLab again and lists the repository (the secret and commit IDs are masked).
    # Copy: git clone http://<lambda-user>:<token>@gitlab/<lambda-user>/<project>.git
    And the healed CI/CD variable clones the repository again
    # Chapter: A project that drifted is put back in one command
    # Note: A project the framework set up on install day: the access-tokens page lists the two automation tokens it created, one for the release, one for the dependency robot.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/access_tokens
    Given a project the framework set up, carrying both its automation tokens
    # Note: Someone went into the settings and loosened the default branch by hand: maintainers may push to it again, which the toolbox never leaves that way.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/repository
    And someone loosened its default branch by hand
    # Note: And a framework file was edited in the copy on disk: the pipeline file now ends with a line nobody from the toolbox wrote.
    # Copy: tail -4 .gitlab-ci.yml
    And a framework file was edited in place
    # Note: One command. It re-applies the project's own answers, then redoes the GitLab setup from scratch: it revokes both automation tokens and creates new ones, even though they still worked, and resets the branch protection.
    # Copy: task devsecops:reload
    When the developer reloads the framework
    # Note: The pipeline file is back to the bytes the toolbox ships — the hand-written line is gone.
    # Copy: tail -4 .gitlab-ci.yml
    Then the framework file is back to what the toolbox ships
    # Note: The default branch is strict again: no one may push to it, maintainers may merge.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/repository
    And the default branch is locked down again
