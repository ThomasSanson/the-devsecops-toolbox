@devsecops @codeceptjs @dockerfile
Feature: CodeceptJS Dockerfile uses npm instead of bun
  As a DevSecOps engineer
  I want the CodeceptJS Dockerfile to use npm ci for dependency installation
  So that dependencies are resolved strictly from the package-lock.json

  Scenario: CodeceptJS Dockerfile installs dependencies with npm ci
    Given the CodeceptJS Dockerfile exists
    Then the CodeceptJS Dockerfile should contain "npm ci"
    And the CodeceptJS Dockerfile should NOT contain "bun install"
    And the CodeceptJS Dockerfile should NOT contain "bun.sh"
