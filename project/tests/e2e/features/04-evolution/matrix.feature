@e2e @e2e-render-matrix
Feature: Template rendering matrix — every Copier answer renders the expected project
  As a DevSecOps engineer
  I want every possible Copier answer (runtime, compose, CI platform, ansible,
  automerge, project mode, gherkin language) to render the expected files
  So that a template bug in any answer, default or not, can never ship silently

  # ONE sentence = ONE storyboard card = ONE pixel baseline, asserted inside the
  # step itself (tolerance: 0). The anchor scenario renders the template with
  # every default answer and tells the manifests every downstream FS assert
  # relies on; the second scenario renders the template once per non-default
  # answer and shows exactly what that one answer changes, each card twinned
  # with the same programmatic assert a regression would trip even without eyes.
  @e2e-render-matrix-defaults
  Scenario: A default render delivers the canonical docker, compose and project layout
    Given a project is rendered from the working-branch template with every default Copier answer
    Then the rendered tree delivers the canonical docker, compose and project layout
    And the root Taskfile wires in the default docker-ce and compose toolchain
    And the CI pipeline ships the default docker-in-docker variables and release gate
    And the project's own governance and language config are delivered

  @e2e-render-matrix-answers
  Scenario: Each non-default Copier answer changes exactly what it promises
    Given the default answers render docker-ce, compose and English as the baseline
    Then choosing podman as the runtime replaces docker-ce and compose with podman config
    And turning off docker compose drops the compose file but keeps docker-ce
    And turning on Ansible delivers its config and lint tooling
    And choosing a self-hosted CI platform changes the docker-in-docker variables
    And turning off project mode removes the project directory entirely
    And turning off automerge removes the fast-forward rule from the renovate config
    And choosing French Gherkin changes the language rule for generated tests
