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
    # Note: A freshly initialized project already has commit checks turned on: init installed a commit-msg hook, a script that runs before every commit message is accepted. The card proves the hook is there, not what it says.
    # Copy: test -f .git/hooks/commit-msg && echo "commit-msg hook installed"
    Given a framework project has the commit hooks installed
    # Note: A conventional commit message follows a fixed pattern: a short type word, a colon, then a plain instruction — like "feat: add login page".
    # Copy: feat: dogfood the commitlint hook
    When a developer writes a conventional commit message
    # Note: The commit-msg hook calls commitlint, which accepts the message because it matches the pattern.
    # Copy: git commit --allow-empty -m "feat: dogfood the commitlint hook"
    Then the hooks accept it and let the commit through
    # Note: "sloppy" is not one of the allowed type words, so commitlint is about to reject it.
    # Copy: sloppy: skip the conventions
    When a developer writes a sloppy commit message
    # Note: commitlint blocks the commit and lists exactly which rules it broke.
    # Copy: git commit --allow-empty -m "update stuff"
    Then the hooks reject it with their own explanation
    # Chapter: Secrets never reach the repository
    # Note: A freshly rendered project, committed once and checked out on its own feature branch: nothing to report yet.
    # Copy: git status
    Given a project protected by the framework's secret scanner starts on a clean feature branch
    # Note: Ordinary work: one file gets committed, another sits in the project without being committed, and a third is listed in .gitignore so git skips it. The scanner must leave all three alone.
    # Copy: git status --short --ignored
    When the developer commits ordinary tracked, untracked and ignored files
    # Note: scan-branch runs clean and prints "No secrets detected in branch commits."
    # Copy: task gitleaks:scan-branch
    Then the scan finds nothing to report
    # Note: A fresh project (its own branch history): a fake RSA private key lands in a tracked file and gets committed like any other change.
    # Copy: cat tracked-secret.pem
    When the developer accidentally commits a private key to the branch
    # Note: scan-branch fails and prints "Gitleaks detected secrets in your branch commits!"
    # Copy: task gitleaks:scan-branch
    Then the scan blocks it and names the leak
    # Note: A fresh project again: the secret file is listed in .gitignore before it is ever committed, so the scanner never even looks at it.
    # Copy: git diff -- .gitignore
    When the developer keeps a second secret out of the scan by gitignoring the file it lives in
    # Note: scan-branch runs clean again and prints the same "No secrets detected in branch commits." line — the gitignored key was never part of what it scanned.
    # Copy: task gitleaks:scan-branch
    Then the scan passes silently, the ignored secret stays out of sight
