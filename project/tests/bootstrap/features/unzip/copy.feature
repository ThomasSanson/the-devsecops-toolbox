@bootstrap @unzip @bootstrap-unzip-copy
Feature: Bootstrap harness prepares the Ubuntu workspace without bind mounts
  As a bootstrap test runner in Docker-in-Docker
  I want the generated toolbox project to be copied into the Ubuntu container
  So that the workspace is available reliably in CI

  Scenario: The generated project is copied into /workspace
    Then the bootstrap step definitions file should contain "docker cp ${shellEscape(`${this.generatedProjectDir}/.`)} ${shellEscape(`${this.containerName}:${CONTAINER_WORKDIR}`)}"
    And the bootstrap step definitions file should not contain "-v ${shellEscape(this.generatedProjectDir)}:${CONTAINER_WORKDIR}"
