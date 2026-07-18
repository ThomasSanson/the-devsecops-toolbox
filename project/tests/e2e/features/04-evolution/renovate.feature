@e2e @e2e-renovate
Feature: Dependency updates flow through the framework, not around it
  As a maintainer of the DevSecOps Toolbox and of every project it generates
  I want the rendered Renovate config to pass the real validator and to keep
  .config tool updates centralized in the framework, never in downstream projects
  So that a generated project only ever receives the framework-evolution MR,
  while the framework itself stays the single place .config tool bumps land

  # ONE Gherkin sentence = ONE storyboard card = ONE pixel baseline, asserted
  # inside the step (tolerance: 0). The journey: a generated project's rendered
  # renovate config is real, valid config — proven by the actual
  # renovate-config-validator, on and off automerge — then the centralization
  # contract itself, both ways: a downstream (generated) project's Renovate
  # IGNORES stale framework-owned .config pins yet TRACKS its own project/**
  # dependency, while the FRAMEWORK repo's Renovate detects that very same
  # .config drift — the framework evolves .config, downstream never does.
  @e2e-renovate-contract
  Scenario: the rendered renovate config centralizes .config updates in the framework
    Given a generated project carries the framework's centralized renovate config
    When the config passes the real renovate validator
    Then turning automerge off still passes the same validator
    And a downstream project's renovate ignores stale framework-owned .config drift
    And a downstream project's renovate tracks its own outdated project dependency
    And the framework repo's own renovate detects that same stale .config drift

  # Both PLACES a bootstrap tool version is pinned — its canonical .config
  # source AND the install.sh bootstrap line — must be seen by Renovate, or one
  # of them would silently drift on the next release. Regress every tool to an
  # older version in a throwaway framework copy and run the framework's real
  # `task renovate:dry-run` entrypoint: its own extraction summary AND the
  # per-tool per-endpoint mapping both show every tool caught at both places.
  @e2e-renovate-detection
  Scenario: Renovate detects every bootstrap tool at both its pinned endpoints
    Given a safe copy of the framework has every bootstrap tool regressed to an older version
    Then Renovate's own extraction log detects every regressed tool
    And each tool is detected at both its config source and the install.sh pin
