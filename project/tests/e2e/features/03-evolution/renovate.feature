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
    # Note: .config tooling is owned by THIS framework repo, so a generated project must NOT receive per-tool Renovate MRs, only the framework-evolution MR. The image is the rendered config, where a rule re-added for one specific tool would stand out.
    # Copy: cat .config/renovate/config.json
    Given a generated project carries the framework's centralized renovate config
    # Note: renovate-config-validator itself checks the rendered config, doing far more than a plain JSON.parse would.
    # Copy: renovate-config-validator .config/renovate/config.json
    When the config passes the real renovate validator
    # Note: The automerge-off branch of the template is real, valid config too.
    # Copy: uvx --python 3.14 --from copier==9.14.3 copier copy --defaults --data devsecops_automerge=false /workspace <project> && renovate-config-validator .config/renovate/config.json
    Then turning automerge off still passes the same validator
    # Note: Off-camera: a freshly generated project with every framework-owned .config pin downgraded to a stale value. Renovate's own extraction summary then lists no .config file — the downstream project never re-tracks a framework tool.
    # Copy: task renovate:dry-run TASK_RENOVATE_DRY_RUN=extract
    And a downstream project's renovate ignores stale framework-owned .config drift
    # Note: A separate freshly generated project, this time with an outdated base image added under project/: its extraction summary picks up the project/ Dockerfile — project/** is exactly what a generated project is meant to track.
    # Copy: task renovate:dry-run TASK_RENOVATE_DRY_RUN=extract
    And a downstream project's renovate tracks its own outdated project dependency
    # Note: The SAME .config downgrade, run in a throwaway framework checkout instead of a generated project: here renovate MUST detect it — the framework owns .config and tracks its own tool versions. Downstream ignores, the framework evolves them.
    # Copy: task renovate:dry-run TASK_RENOVATE_DRY_RUN=extract
    And the framework repo's own renovate detects that same stale .config drift
    # Chapter: Every pinned tool is watched in both places
    # Note: Off-camera: a full throwaway copy of the framework, git-pristine first. Each bootstrap tool is then pinned OLDER in both its canonical .config source and the install.sh bootstrap pin — the real git diff shows every OLD to regressed move.
    # Copy: git diff
    Given a safe copy of the framework has every bootstrap tool regressed to an older version
    # Note: The framework's real entrypoint runs against the regressed copy; Renovate's own "Dependency extraction complete" summary lists every regex/pip manager hit plus githubDeps.
    # Copy: task renovate:dry-run TASK_RENOVATE_DRY_RUN=extract
    Then Renovate's own extraction log detects every regressed tool
    # Note: The rule made visible: every tracked tool is reported from its canonical .config source AND install.sh, so one Renovate PR touches both files, never only one.
    # Copy: task renovate:dry-run TASK_RENOVATE_DRY_RUN=extract
    And each tool is detected at both its config source and the install.sh pin
