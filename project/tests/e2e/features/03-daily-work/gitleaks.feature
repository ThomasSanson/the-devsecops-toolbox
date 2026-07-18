@e2e @e2e-gitleaks
Feature: Gitleaks secret scanning protects a generated project's branches
  As a developer using a generated project
  I want `task gitleaks:scan-branch` to detect committed secrets and stay
  silent on clean branches and gitignored files
  So that the framework's core security promise actually holds

  # ONE storyboard: the whole secret-scanning promise as one developer
  # journey. ONE Gherkin sentence = ONE storyboard card = ONE pixel
  # baseline, asserted inside the step (tolerance: 0). The scan's own
  # verdict lines (deterministic, the scan-range SHA masked) are rendered to
  # a dark <pre> and twinned with a programmatic assert on the captured exit
  # code and output, so a regression fails loud even without eyes. Three
  # situations share the scenario, each starting its OWN fresh rendered
  # project on its OWN feature branch (scan-branch scans the whole branch
  # history since main, so a later commit must never bleed into an earlier
  # verdict): an ordinary branch stays green, a committed secret gets
  # blocked and named, and a secret kept out of git's view via .gitignore
  # never reaches the scanner at all.
  @e2e-gitleaks-promise
  Scenario: gitleaks keeps ordinary branches green and blocks committed secrets
    Given a project protected by the framework's secret scanner starts on a clean feature branch
    When the developer commits ordinary tracked, untracked and ignored files
    Then the scan finds nothing to report
    When the developer accidentally commits a private key to the branch
    Then the scan blocks it and names the leak
    When the developer keeps a second secret out of the scan by gitignoring the file it lives in
    Then the scan passes silently, the ignored secret stays out of sight
