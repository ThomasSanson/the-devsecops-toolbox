@megalinter-proxy @scaffolding @megalinter @proxy
Feature: MegaLinter Proxy Support
  As a DevSecOps engineer
  I want MegaLinter to forward proxy environment variables to its Docker container
  So that linters and pre-commands can access external resources through corporate proxies

  @docker-proxy
  Scenario: MegaLinter docker task injects proxy args into docker run command
    Given a clean temporary directory for "megalinter/proxy" tests
    When the copier command is executed with default settings
    Then the task "docker" in file ".config/megalinter/Taskfile.yml" should contain "{{.TASK_MEGALINTER_PROXY_DOCKER_ARGS}}"

  @npx-proxy
  Scenario: MegaLinter npx task injects proxy args into mega-linter-runner command
    Given a clean temporary directory for "megalinter/proxy" tests
    When the copier command is executed with default settings
    Then the task "npx" in file ".config/megalinter/Taskfile.yml" should contain "{{.TASK_MEGALINTER_PROXY_NPX_ARGS}}"

  @proxy-with-vars
  Scenario: Proxy args are correctly resolved when proxy env vars are set
    Given a clean temporary directory for "megalinter/proxy" tests
    When the copier command is executed with default settings
    And I run task "megalinter:proxy:debug" in the generated project with env vars:
      | HTTP_PROXY  | http://proxy.test:8080  |
      | HTTPS_PROXY | https://proxy.test:8443 |
      | NO_PROXY    | localhost,127.0.0.1     |
    Then the task output should contain "DOCKER_PROXY_ARGS="
    And the task output should contain "-e HTTP_PROXY=http://proxy.test:8080"
    And the task output should contain "-e HTTPS_PROXY=https://proxy.test:8443"
    And the task output should contain "-e NO_PROXY=localhost,127.0.0.1"
    And the task output should contain "NPX_PROXY_ARGS="
    And the task output should contain "--env HTTP_PROXY=http://proxy.test:8080"
    And the task output should contain "--env HTTPS_PROXY=https://proxy.test:8443"
    And the task output should contain "--env NO_PROXY=localhost,127.0.0.1"

  @proxy-without-vars
  Scenario: Proxy args are empty when no proxy env vars are set
    Given a clean temporary directory for "megalinter/proxy" tests
    When the copier command is executed with default settings
    And I run task "megalinter:proxy:debug" in the generated project
    Then the task output should contain "DOCKER_PROXY_ARGS="
    And the task output should contain "NPX_PROXY_ARGS="
    And the task output should not contain "-e HTTP_PROXY"
    And the task output should not contain "--env HTTP_PROXY"
