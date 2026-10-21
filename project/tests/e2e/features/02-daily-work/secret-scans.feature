@e2e
Feature: the framework guards what reaches the repository: clean commits and no secrets
  As a developer using the toolbox
  I want the checks a generated project ships to accept clean commits, turn
  back sloppy ones, and stop committed secrets from ever entering the history
  So that the project's own commit rules and secret scanning actually apply.

  # Two scans of the same project, started at the same time on the same Docker
  # daemon, as when two terminals or two repositories share a machine (issue
  # #243). The project keeps the default answers, so every scan runs in a
  # container. The scans used to share one container name and remove it
  # before and after their run, so each could stop the other's scanner.
  @concurrent-scans
  Scenario: two secret scans started at the same time each block the password from a container of their own
    # Note: A project generated with the default answers. Its .config/betterleaks/Taskfile.yml keeps TASK_BETTERLEAKS_MODE at "docker", so every scan starts a container.
    # Note: Since the main branch, a commit adds src/service.js with a synthetic password on line 1. A second line with the same password is staged.
    # Copy: grep TASK_BETTERLEAKS_MODE .config/betterleaks/Taskfile.yml && git diff origin/main HEAD -- src/service.js && git diff --cached -- src/service.js
    Given a project that scans in Docker holds a synthetic password, committed and staged
    # Note: Two full scans start together. Each one runs betterleaks in a container named betterleaks-container followed by an id of its own, and removes only that container when it ends.
    # Note: Both find the two lines, print "REDACTED" where the password was, and fail with "❌ Betterleaks detected secrets in your code!". The test also starts two staged scans and two branch scans together, and each of them blocks the password too.
    # Copy: task betterleaks:scan-full & task betterleaks:scan-full; wait
    Then two full scans started at the same time both block the password, each from its own container

  # Both scan modes side by side, on the three entry points a developer runs:
  # scan-full (every file), protect (the staged files) and scan-branch (the
  # commits since the main branch). Each card shows the Docker project on the
  # left and the binary project on the right, answering the same command. The
  # binary scans run with no reachable Docker daemon, so a scan that tried to
  # start a container would fail. The complete native output is checked before
  # any display normalization.
  @scanner-log-redaction
  Scenario: a secret is blocked without copying its value into the scan log
    # Chapter: Ordinary work passes in both modes
    # Note: Two projects generated with different install answers. The Docker one keeps the Taskfile default, "docker". The binary one answered that its runners refuse privileged containers, and its .env.dist says TASK_BETTERLEAKS_MODE=binary.
    # Note: Each has a clean commit and a clean staged change, so no scan reads an empty input.
    Given clean framework projects use Docker and binary scanners from their install answers
    # Note: The three scans, in each project. All six print their own "No secrets detected" line.
    # Copy: task betterleaks:scan-full && task betterleaks:protect && task betterleaks:scan-branch
    Then full, staged and branch scans pass on ordinary work in both modes
    # Chapter: A detected value stays out of the log
    # Note: Only a synthetic password is used. One line is committed and a second one is staged, so every scan has a real finding to block.
    When a synthetic password is committed and staged in both projects
    # Note: The full scan finds both lines. Each finding names the rule generic-password, the file and the line, and shows "REDACTED" where the value was.
    # Copy: task betterleaks:scan-full
    Then full scans block the secret and redact its value in both modes
    # Note: The staged scan finds the staged line, line 2, and hides its value the same way.
    # Copy: task betterleaks:protect
    And staged scans block the secret and redact its value in both modes
    # Note: The branch scan finds the committed line, line 1, in the commit that added it, and hides its value the same way.
    # Copy: task betterleaks:scan-branch
    And branch scans block the secret and redact its value in both modes

  # betterleaks dir, the scanner behind task betterleaks:scan-full and the
  # MegaLinter run, reads every file of the working tree, git-ignored ones
  # included. A library a package manager fetched is read like the project's
  # own code, unless the allowlist of .config/betterleaks/config.toml skips its
  # folder (issue #228). The project keeps the default answers, so the scan
  # runs in a container.
  @vendor-allowlist
  Scenario: the full scan skips the libraries under vendor/ and still blocks a password in the project's own code
    # Note: A project generated from the toolbox. vendor/acme/mailer stands for a library that Composer, the PHP package manager, installed there, and one of its test files holds a made-up password. The developer wrote the same line in src/mailer.php.
    # Copy: grep -rn password src vendor
    Given a generated project holds the same made-up password in its own src/ and in a library under vendor/
    # Note: The full scan reads every file of the project. It finds the password in src/mailer.php, line 2, prints "REDACTED" where the value was, and fails: "❌ Betterleaks detected secrets in your code!".
    # Note: The same line under vendor/ is not reported: "leaks found: 1".
    # Copy: task betterleaks:scan-full
    When the developer runs the full secret scan, it blocks src/mailer.php and skips vendor/
    # Note: The file every scan of the project reads. Its allowlist, the list of paths the scan skips, names '''(^|/)vendor/''' with the other folders that hold no code of the project's own.
    # Note: Above [extend], it says how a project adds paths of its own: copy this file whole, then point TASK_BETTERLEAKS_CONFIG and REPOSITORY_BETTERLEAKS_CONFIG_FILE at the copy. It also says "Never point `[extend] path` at this file": MegaLinter already wraps this file, betterleaks follows two extends at most, and the MegaLinter scan would load no rule and pass.
    # Copy: cat .config/betterleaks/config.toml
    Then the scan's config lists vendor/ and tells a project allowlist to stand on its own, never to extend it

  # Betterleaks' default rules catch a token assigned to a name such as apiKey,
  # but not the same token written into an HTTP Authorization header, the shape
  # every fetch or axios call to an API uses (issue #157). A downstream project
  # committed a live token that way and every scan passed. The project keeps the
  # default answers, so the scan runs in a container.
  @bearer-token
  Scenario: the full scan blocks a token written into an Authorization header
    # Note: A project generated from the toolbox. src/client.js calls an API with a made-up 32-character token in its Authorization header, after the word Bearer, the way the developer would paste it from the API's settings page.
    # Copy: cat src/client.js
    Given a generated project calls an API with a token written into its Authorization header
    # Note: The full scan reads every file of the project. It finds the token in src/client.js, line 2, under the rule bearer-token-hardcoded, prints "REDACTED" where the value was, and fails: "❌ Betterleaks detected secrets in your code!".
    # Copy: task betterleaks:scan-full
    When the developer runs the full secret scan, it blocks the token in the Authorization header
