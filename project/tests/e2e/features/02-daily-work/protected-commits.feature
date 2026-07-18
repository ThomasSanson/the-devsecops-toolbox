@e2e @protected-commits
Feature: the framework guards what reaches the repository — clean commits and no secrets
  As a developer using the toolbox
  I want the checks `task devsecops:init` installs to accept clean commits, turn
  back sloppy ones, and stop committed secrets from ever entering the history
  So that the project's own commit rules and secret scanning actually apply.

  # ONE story in two chapters. ONE Gherkin sentence = ONE card = ONE pixel
  # baseline, asserted inside the step (tolerance: 0); each verdict card twins
  # its terminal frame with a programmatic check (exit code / scan output) of
  # the same fact, so a regression fails loud even without eyes.
  #
  # Chapter 1 — the commit message: a freshly initialized project carries the
  # installed commit-msg hook; a conventional commit sails through, a sloppy one
  # is turned back with commitlint's own explanation. Chapter 2 — secrets: each
  # situation starts its OWN fresh project on its OWN feature branch (the scan
  # reads the whole branch history since main, so a later commit must never
  # bleed into an earlier verdict). An ordinary branch stays green, a committed
  # private key is blocked and named, and a secret kept out of git's view via
  # .gitignore never reaches the scanner at all.
  Scenario: the commit checks accept clean work and secrets never reach the repository
    # Chapter: The commit message is checked
    Given a framework project has the commit hooks installed
    When a developer writes a conventional commit message
    Then the hooks accept it and let the commit through
    When a developer writes a sloppy commit message
    Then the hooks reject it with their own explanation
    # Chapter: Secrets never reach the repository
    Given a project protected by the framework's secret scanner starts on a clean feature branch
    When the developer commits ordinary tracked, untracked and ignored files
    Then the scan finds nothing to report
    When the developer accidentally commits a private key to the branch
    Then the scan blocks it and names the leak
    When the developer keeps a second secret out of the scan by gitignoring the file it lives in
    Then the scan passes silently, the ignored secret stays out of sight
