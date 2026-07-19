@e2e @quality-gate
Feature: a freshly generated project passes its own quality gate
  As a developer who just scaffolded a project from the template
  I want `task megalinter` to come back green on the untouched scaffold
  So that the CI `code` stage is green on day one, before I write any code.

  # The generated project ships a full MegaLinter suite (~35 linters) and a CI
  # `code` stage that runs it. This story renders a vanilla project and runs that
  # exact linter suite on it, untouched, proving the gate is green out of the box
  # and that the secret + dependency scanners find nothing. ONE Gherkin sentence
  # = ONE card = ONE pixel baseline (tolerance: 0); every card twins its terminal
  # frame with an exit-code / verdict check of the same fact.
  Scenario: the untouched scaffold's linter suite comes back green
    # Note: A project straight out of the template: nothing edited yet, a clean git tree sitting at version 0.1.0.
    # Copy: git status --short ; cat VERSION
    Given a freshly generated project, still untouched
    # Note: The developer runs the project's whole linter suite (task megalinter, the same command the CI code stage runs) on the untouched scaffold. It comes back green: MegaLinter exits 0, so the gate passes.
    # Copy: task megalinter
    When the developer runs the whole linter suite on it
    # Note: The secret and dependency scanners (gitleaks, trivy, trufflehog, grype) all report zero findings, so the scaffold has nothing leaking and no known-vulnerable dependency out of the box.
    # Copy: task megalinter
    Then the secret and dependency scanners all come back clean
