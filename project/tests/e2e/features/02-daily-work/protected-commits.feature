@e2e
Feature: the framework guards what reaches the repository — clean commits and no secrets
  As a developer using the toolbox
  I want the checks `task devsecops:init` installs to accept clean commits, turn
  back sloppy ones, and stop committed secrets from ever entering the history
  So that the project's own commit rules and secret scanning actually apply.

  # ONE story in four chapters. ONE Gherkin sentence = ONE card = ONE pixel
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
  # .gitignore never reaches the scanner at all. Chapter 3 — getting unstuck:
  # deleting the file is not enough, rewriting the history is. Chapter 4 — the
  # same scan from the pinned binary (issue #225): a project whose runners
  # refuse privileged containers scans with the checksum-verified release
  # binary instead of an image, and the verdict does not change.
  @protected-commits
  Scenario: the commit checks accept clean work and secrets never reach the repository
    # Chapter: The commit message is checked
    # Note: A freshly initialized project already has commit checks turned on: init installed a commit-msg hook, a script that runs before every commit message is accepted. The card proves the hook is there, not what it says.
    # Copy: test -f .git/hooks/commit-msg && echo "commit-msg hook installed"
    Given a framework project has the commit hooks installed
    # Note: A teammate clones the very same project from the folder next door — the framework rides along, Taskfile and all. Yet git NEVER copies hooks on a clone, from any remote or path: .git/hooks holds no commit-msg, so at this instant nothing guards their commits.
    # Copy: git clone e2e-commit-hooks-repo e2e-commit-hooks-clone
    When a teammate clones the same project bare, with no commit hooks yet
    # Note: task dev:setup-environment is the one-time setup every clone runs (the dev container even runs it for you when it builds): it checks the toolchain and finishes by installing the git hooks. From here the teammate's clone is guarded exactly like the original — the next cards commit from THIS clone.
    # Copy: task dev:setup-environment
    Then task dev:setup-environment turns the hooks on, exactly as the dev container does on build
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
    # Copy: task betterleaks:scan-branch
    Then the scan finds nothing to report
    # Note: A fresh project (its own branch history): a fake RSA private key lands in a tracked file and gets committed like any other change.
    # Copy: cat tracked-secret.pem
    When the developer accidentally commits a private key to the branch
    # Note: scan-branch fails and prints "Betterleaks detected secrets in your branch commits!"
    # Copy: task betterleaks:scan-branch
    Then the scan blocks it and names the leak
    # Note: A different trap the scanner used to fall into: its allowlist told it to skip every .env file AND secrets.yaml, exactly the files where a real key or token is most likely to sit. Here a private key is force-committed inside a file literally named secrets.yaml.
    When the developer commits a secret inside a secrets.yaml the scanner used to ignore
    # Note: The scan blocks the branch and names the leak, just as it did for the .pem. The allowlist no longer looks away from secrets.yaml or .env files (issue #182), so a secret parked in one can no longer slip in unseen.
    Then the scan blocks it too, now the allowlist no longer skips secrets files
    # Note: A fresh project again: the secret file is listed in .gitignore before it is ever committed, so the scanner never even looks at it.
    # Copy: git diff -- .gitignore
    When the developer keeps a second secret out of the scan by gitignoring the file it lives in
    # Note: scan-branch runs clean again and prints the same "No secrets detected in branch commits." line — the gitignored key was never part of what it scanned.
    # Copy: task betterleaks:scan-branch
    Then the scan passes silently, the ignored secret stays out of sight
    # Chapter: Getting out of a secret block
    # Note: A fresh project on its own branch with a private key already committed: the scan already refuses the branch. This is where a stuck developer starts.
    # Copy: task betterleaks:scan-branch
    Given a committed private key is blocking a fresh branch
    # Note: The obvious first reflex: delete the file and commit the deletion. It removes the key from the latest version, but the earlier commit that added it is still in the branch history.
    # Copy: git rm tracked-secret.pem && git commit -m "chore: remove the secret file"
    When the developer deletes the secret file and commits the removal
    # Note: The scan reads the whole branch history since main, not just the latest files. It still finds the key in the commit that added it, so deleting the file did not help. This is the trap.
    # Copy: task betterleaks:scan-branch
    Then the scan still refuses the branch because the secret stays in its history
    # Note: task git:clean-secrets removes the file from every commit in the branch history, not just the latest one, and rewrites the branch. The destructive-operation prompt is answered with yes.
    # Copy: task git:clean-secrets -- tracked-secret.pem
    When the developer rewrites the history with the framework's clean-secrets task
    # Note: With the key gone from every commit, the scan passes: "No secrets detected in branch commits." The branch the scan was blocking is safe to push now.
    # Copy: task betterleaks:scan-branch
    Then the scan comes back clean and the branch is safe to push
    # Chapter: The same scan, from the pinned binary
    # Note: A project whose runners may not start containers answers so at install time, and carries TASK_BETTERLEAKS_MODE=binary. The scanner is then the official binary pinned in .config/betterleaks/version, downloaded once and checked against the checksum published with that release. No container, no root, no sudo.
    # Copy: task betterleaks:install
    When a project set to the binary mode installs the pinned scanner
    # Note: The same private key, committed on a fresh branch, scanned by the same command in that mode. The verdict is word for word the one the container gives: "Betterleaks detected secrets in your branch commits!" — and no container was started at any point.
    # Copy: task betterleaks:scan-branch
    Then the same committed key is blocked again, and no container was ever started
