@e2e @e2e-glab-auth-ensure
Feature: Developer journey — the auth check names the missing piece and the right host
  As a developer setting up the DevSecOps Toolbox
  I want `task glab:auth:ensure` to stop right away with the exact command to run next
  When a UI tool or the CLI is missing, or I have not signed in to GitLab yet
  And to read my GitLab host straight from the git remote (and tidy it up)
  So that it always names the right next command and the right host

  # The auth family, merged into TWO storyboards. Both drive `task
  # glab:auth:ensure` in a fresh Ubuntu container and render its captured
  # stdout to a dark <pre> (no ttyd round-trip). ONE sentence = ONE card = ONE
  # pixel baseline, asserted inside the step (tolerance: 0); each verdict card
  # twins its frame with a programmatic assert of the same fact.

  # A single developer walks the check forward, installing one dependency at a
  # time: the check stops at the next missing piece and names its remedy. One
  # container, four verdicts in the order the check runs them (gum -> glow ->
  # glab -> sign-in).
  @e2e-auth-guidance-verdicts
  Scenario: the auth check names each missing piece as the developer installs them
    Given a fresh toolbox checkout with none of its UI tools installed yet
    When the developer runs the auth check straight away
    When the developer installs gum and re-runs the check
    When the developer adds glow and re-runs, leaving only the CLI missing
    When the developer installs the CLI and re-runs it in CI mode, still not signed in

  # The check reads the GitLab host from the git remote, and normalizes an
  # SSH-style gitlabssh.* remote back to its gitlab.* API host. One container
  # with the CLIs installed; the remote is re-pointed between the two verdicts.
  @e2e-auth-host-detection
  Scenario: the auth check detects and normalizes the GitLab host from the remote
    Given a self-hosted GitLab project with the tools installed but no sign-in yet
    Then the check reads the self-hosted GitLab host straight from the remote
    When the same project instead uses an SSH-style gitlabssh remote
    Then the check turns it back into the gitlab API host
