@e2e @e2e-template-version-pins
Feature: The curl|sh installer pins the same tool versions as the framework
  install.sh bootstraps task / copier / gum / glow BEFORE .config/ exists
  (Copier fetches the framework afterwards), so it must self-contain versions.
  Those bootstrap pins MUST stay equal to the canonical .config/<tool>/version
  files — otherwise the installer drifts from the framework. Renovate keeps them
  aligned automatically; this pixel baseline (tolerance:0) shows the per-tool
  aligned/DRIFT verdict, so any divergence regresses visibly. An aligned version
  is masked and a drifted one is spelled out: the number moves on every bump and
  proves nothing, the verdict beside it proves everything.

  @e2e-template-version-pins-aligned
  Scenario: install.sh bootstrap pins stay aligned with the framework
    Then the install.sh bootstrap pins should visually match "template/version-pins"
