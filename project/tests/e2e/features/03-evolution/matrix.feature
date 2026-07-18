@e2e @render-matrix
Feature: Template rendering matrix — every Copier answer renders the expected project
  As a DevSecOps engineer
  I want every possible Copier answer (runtime, compose, CI platform, ansible,
  automerge, project mode, gherkin language) to render the expected files
  So that a template bug in any answer, default or not, can never ship silently

  # ONE story in two chapters. ONE Gherkin sentence = ONE card = ONE pixel
  # baseline, asserted inside the step (tolerance: 0). Every listing or grep
  # shown is the REAL command run against the real render — no composed output —
  # and each card twins its frame with the same filesystem check a regression
  # would trip even without eyes.
  #
  # Chapter 1 renders the template with every default answer and shows what the
  # canonical project looks like. Chapter 2 renders the template once per
  # non-default answer and shows exactly what that one answer changes, nothing
  # more.
  Scenario: the default render is canonical, and each answer changes exactly what it promises
    # Chapter: What the default project looks like
    Given a project is rendered from the working-branch template with every default Copier answer
    Then the rendered tree delivers the canonical docker, compose and project layout
    And the root Taskfile wires in the default docker-ce and compose toolchain
    And the CI pipeline ships the default docker-in-docker variables and release gate
    And the project's own governance and language config are delivered
    # Chapter: Each answer changes exactly what it promises
    Given the default answers render docker-ce, compose and English as the baseline
    Then choosing podman as the runtime replaces docker-ce and compose with podman config
    And turning off docker compose drops the compose file but keeps docker-ce
    And turning on Ansible delivers its config and lint tooling
    And choosing a self-hosted CI platform changes the docker-in-docker variables
    And turning off project mode removes the project directory entirely
    And turning off automerge removes the fast-forward rule from the renovate config
    And choosing French Gherkin changes the language rule for generated tests
