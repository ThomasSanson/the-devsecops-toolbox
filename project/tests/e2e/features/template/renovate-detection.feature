@e2e @e2e-template-renovate-detection
Feature: Renovate detects every bootstrap tool at BOTH endpoints
  task / copier / gum / glow are pinned in TWO places: the canonical
  .config/<tool> source AND the install.sh bootstrap pin. If Renovate's config
  missed one endpoint, that place would silently drift on the next release.
  This test regresses every tool to an older version in a safe throwaway copy,
  runs the real (baked, offline) Renovate in dry-run extract mode, and proves —
  with a pixel baseline — that Renovate detects each tool, with its update
  datasource, at BOTH endpoints. Detection at both endpoints is exactly what
  makes Renovate edit both files in one update PR.

  @e2e-template-renovate-detection-both-endpoints
  Scenario: regressing each tool is detected by Renovate at both endpoints
    Given a safe copy of the framework with each bootstrap tool regressed to an older version
    Then Renovate should detect each regressed tool at both endpoints, visually matching "template/renovate-detection"
