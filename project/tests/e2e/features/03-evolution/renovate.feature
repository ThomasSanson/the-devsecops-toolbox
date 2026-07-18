@e2e @renovate-flow
Feature: Dependency updates flow through the framework, not around it
  As a maintainer of the DevSecOps Toolbox and of every project it generates
  I want the rendered Renovate config to pass the real validator and to keep
  .config tool updates centralized in the framework, never in downstream projects
  So that a generated project only ever receives the framework-evolution MR,
  while the framework itself stays the single place .config tool bumps land

  # ONE story in two chapters. ONE Gherkin sentence = ONE card = ONE pixel
  # baseline, asserted inside the step (tolerance: 0). Renovate is the tool that
  # opens dependency-update merge requests. Every card twins its frame with the
  # real validator or the real `task renovate:dry-run`, so a regression fails
  # loud even without eyes.
  #
  # Chapter 1 — the centralization contract, both ways: the rendered config is
  # real, valid config (proven by the actual renovate-config-validator, on and
  # off automerge), a downstream project's Renovate IGNORES stale
  # framework-owned .config pins yet TRACKS its own project/** dependency, while
  # the FRAMEWORK repo's Renovate detects that very same .config drift. Chapter 2
  # — both PLACES a bootstrap tool version is pinned (its .config source AND the
  # install.sh bootstrap line) must be seen by Renovate, or one would silently
  # drift on the next release.
  Scenario: Renovate centralizes .config updates in the framework and watches every pinned tool at both endpoints
    # Chapter: Updates flow through the framework
    Given a generated project carries the framework's centralized renovate config
    When the config passes the real renovate validator
    Then turning automerge off still passes the same validator
    And a downstream project's renovate ignores stale framework-owned .config drift
    And a downstream project's renovate tracks its own outdated project dependency
    And the framework repo's own renovate detects that same stale .config drift
    # Chapter: Every pinned tool is watched in both places
    Given a safe copy of the framework has every bootstrap tool regressed to an older version
    Then Renovate's own extraction log detects every regressed tool
    And each tool is detected at both its config source and the install.sh pin
