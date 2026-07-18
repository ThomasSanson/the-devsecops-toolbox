@e2e @e2e-token-healing
Feature: init repairs its own GitLab connection when something breaks it
  As a maintainer relying on the toolbox
  I want `task devsecops:init` to be the one command that fixes its own GitLab
  setup — the project access token, the CI/CD variable, and the branch it
  authenticates against — no matter what damage happened behind its back
  So that running it again always leaves one working, matching credential in place.

  # ONE sentence = ONE storyboard card = ONE pixel baseline, asserted inside the
  # step itself (tolerance: 0): a visual regression fails on the exact sentence
  # whose image drifted. The storyboard SVG — selectable, copyable text around
  # the untouched frames, including the command that replays this very scenario —
  # is assembled automatically when the scenario ends. The Given closes the
  # off-camera stage (lambda user, fresh project, the first `task devsecops:init`
  # that provisioned everything) with its visual proof; each When is a real
  # tamper; each Then pairs its GitLab-page or terminal card with a programmatic
  # REST assert of the SAME fact, so a regression fails loud even without eyes.
  #
  # These two scenarios absorb the whole former token/init-effects family:
  #   - init-baseline (the "initialised" stage — the Given card),
  #   - init-token-lifecycle @revoked + init-token-resync (the same heal path:
  #     a missing token is re-provisioned on the next run),
  #   - renovate-token-clone (the usability proof — the healed token clones),
  #   - init-idempotency (the closing no-op — a second run changes nothing),
  #   - init-token-lifecycle @tampered + @duplicate (the variants scenario).
  # The healing matrix stays programmatic: every Then twins a REST assert.

  @e2e-token-healing-journey
  Scenario: init re-creates a revoked automation token end to end
    Given a project the framework has already set up with its automation token
    When the developer revokes the automation token behind the framework's back
    And the developer runs the framework's init again
    Then init has created a brand-new automation token
    And init has updated the CI/CD variable to match the new token
    And the healed token clones the repository over HTTPS
    When the developer runs init a second time
    Then the second run leaves the healed token untouched

  @e2e-token-healing-variants
  Scenario: init repairs a tampered variable and purges duplicate tokens
    Given a project the framework already set up and is healthy
    When a duplicate automation token is planted behind the framework's back
    And the CI/CD variable is overwritten with a bad value
    And the developer runs the framework's init once more
    Then only one automation token survives the purge
    And the healed CI/CD variable clones the repository again
