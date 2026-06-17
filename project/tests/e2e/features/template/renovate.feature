@e2e @e2e-template-renovate
Feature: The rendered renovate configuration passes the real Renovate validator
  As a maintainer of a generated project
  I want both branches of the templated renovate config (automerge on/off)
  validated by renovate-config-validator itself — not just JSON.parse
  So that an invalid rendered config can never ship to downstream projects

  @e2e-template-renovate-validate-default
  Scenario: the default render (automerge on) passes renovate-config-validator
    Given a project rendered from the working-branch template with default answers
    When I run the renovate config validation in the rendered project
    Then the renovate validation should succeed
    And the renovate validation output should contain "Config validated successfully"
    And the renovate validation verdict should visually match "template/renovate-validate-default"

  @e2e-template-renovate-validate-automerge-off
  Scenario: the automerge-off render passes renovate-config-validator
    Given a project rendered from the working-branch template with answers "devsecops_automerge=false"
    When I run the renovate config validation in the rendered project
    Then the renovate validation should succeed
    And the renovate validation output should contain "Config validated successfully"
    And the renovate validation verdict should visually match "template/renovate-validate-automerge-off"

  # .config tooling is owned by the framework repo; downstream projects only get
  # the framework-evolution MR (copier), never per-tool version-bump MRs. The
  # baseline is the actual rendered downstream config — no per-tool customManagers.
  @e2e-template-renovate-centralized
  Scenario: the rendered config centralizes .config tool updates in the framework
    Given a project rendered from the working-branch template with default answers
    Then the rendered renovate config should visually match "template/renovate-rendered-config"

  # Behavioural counterparts: actually RUN the framework's renovate inside a freshly
  # generated project. This repo is a TEMPLATE — generated projects inherit a LIGHTER
  # renovate that IGNORES .config/ (owned by the framework) and only tracks their own
  # project/** deps. The two halves are proven by two focused tests.

  # Half 1 — NEGATIVE: clone the template, downgrade EVERY framework-owned .config
  # version pin to a stale value, run renovate. It must detect nothing under .config —
  # if it did, the downstream config is wrong (a generated project would wrongly open
  # per-tool bump MRs the framework already owns).
  @e2e-template-renovate-downstream-config-ignored
  Scenario: a generated project's Renovate ignores stale framework-owned .config versions
    Given a project rendered from the working-branch template with default answers
    When I downgrade every framework-owned .config version and run renovate in the rendered project
    Then the .config version downgrade should visually match "template/renovate-downstream-config-downgraded"
    And renovate should detect no framework-owned .config update, matching "template/renovate-downstream-config-ignored"

  # Half 2 — POSITIVE: the same generated project, with an outdated dependency added
  # under project/, run renovate. It must detect THAT — project/** is exactly what a
  # generated project's renovate is meant to track.
  @e2e-template-renovate-downstream-project-tracked
  Scenario: a generated project's Renovate tracks its own outdated project/ dependency
    Given a project rendered from the working-branch template with default answers
    When I add an outdated dependency inside the project tree and run renovate in the rendered project
    Then the added project dependency should visually match "template/renovate-downstream-project-dockerfile"
    And renovate should detect the project dependency, matching "template/renovate-downstream-project-tracked"

  # Mirror of Half 1, framework side: the SAME .config downgrade, but run in a framework
  # checkout (not a generated project). Here Renovate MUST detect it — the framework OWNS
  # .config and tracks its tool versions (the source of truth). Downstream ignores, the
  # framework evolves them: that is the whole centralization contract, proven both ways.
  @e2e-template-renovate-framework-config-tracked
  Scenario: a framework checkout's Renovate detects stale .config versions
    Given a throwaway checkout of the framework
    When I downgrade every framework-owned .config version and run renovate in the framework checkout
    Then the .config version downgrade should visually match "template/renovate-framework-config-downgraded"
    And renovate should detect the framework-owned .config updates, matching "template/renovate-framework-config-tracked"
