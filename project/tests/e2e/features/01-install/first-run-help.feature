@e2e @first-run-help
Feature: On the first run, the toolbox names the exact thing to fix
  As a developer setting up the DevSecOps Toolbox
  I want each check to stop and name the next command to run when something is missing
  So that I am never left guessing what to do next

  # ONE story in three chapters, each in its OWN fresh throwaway machine (they
  # never share state). ONE Gherkin sentence = ONE card = ONE pixel baseline,
  # asserted inside the step (tolerance: 0); every verdict card twins its frame
  # with a check of the same fact — the captured message and the exit code.
  # The auth check is `task glab:auth:ensure`; init is `task devsecops:init`.
  #
  # Chapter 1 — the auth check names each missing tool as the developer installs
  # them one at a time: gum, then glow, then the glab CLI, then the missing
  # sign-in. Chapter 2 — the check reads the GitLab host straight from the git
  # remote, and turns an SSH-style gitlabssh address back into the normal one.
  # Chapter 3 — init itself guides: it prints the exact sign-in command, refuses
  # a GitHub remote with the fix, and finishes cleanly when GitLab is turned off.
  Scenario: Every check stops and names the fix, then finishes cleanly once nothing is missing
    # Chapter: The check names each missing tool
    Given a fresh toolbox checkout with none of its UI tools installed yet
    When the developer runs the auth check straight away
    When the developer installs gum and re-runs the check
    When the developer adds glow and re-runs, leaving only the CLI missing
    When the developer installs the CLI and re-runs it in CI mode, still not signed in
    # Chapter: The check reads the right GitLab host
    Given a self-hosted GitLab project with the tools installed but no sign-in yet
    Then the check reads the self-hosted GitLab host straight from the remote
    When the same project instead uses an SSH-style gitlabssh remote
    Then the check turns it back into the gitlab API host
    # Chapter: init names the exact fix, then bows out cleanly
    Given a developer's new project points at a GitLab remote the CLI never signed into
    Then init stops and prints the exact GitLab sign-in command to run
    When another developer's project points at a GitHub remote instead
    Then init refuses the non-GitLab remote and shows how to fix it
    Then init finishes cleanly once the GitLab integration is turned off
