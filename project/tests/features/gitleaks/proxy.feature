@gitleaks-proxy @scaffolding @gitleaks @proxy
Feature: Gitleaks Proxy Support
  As a DevSecOps engineer
  I want Gitleaks to forward proxy environment variables to its Docker container
  So that secret scanning can work through corporate proxies

  @scan-full-proxy
  Scenario: Gitleaks scan-full task injects proxy args into docker run command
    Given a clean temporary directory for "gitleaks/proxy" tests
    When the copier command is executed with default settings
    Then the task "scan-full" in file ".config/gitleaks/Taskfile.yml" should contain "{{.TASK_GITLEAKS_PROXY_ARGS}}"

  @protect-proxy
  Scenario: Gitleaks protect task injects proxy args into docker run command
    Given a clean temporary directory for "gitleaks/proxy" tests
    When the copier command is executed with default settings
    Then the task "protect" in file ".config/gitleaks/Taskfile.yml" should contain "{{.TASK_GITLEAKS_PROXY_ARGS}}"

  @scan-branch-proxy
  Scenario: Gitleaks scan-branch task injects proxy args into docker run command
    Given a clean temporary directory for "gitleaks/proxy" tests
    When the copier command is executed with default settings
    Then the task "scan-branch" in file ".config/gitleaks/Taskfile.yml" should contain "{{.TASK_GITLEAKS_PROXY_ARGS}}"

  @proxy-with-vars
  Scenario: Proxy args are correctly resolved when proxy env vars are set
    Given a clean temporary directory for "gitleaks/proxy" tests
    When the copier command is executed with default settings
    And I run task "gitleaks:proxy:debug" in the generated project with env vars:
      | HTTP_PROXY  | http://proxy.test:8080  |
      | HTTPS_PROXY | https://proxy.test:8443 |
      | NO_PROXY    | localhost,127.0.0.1     |
    Then the task output should contain "PROXY_ARGS="
    And the task output should contain "-e HTTP_PROXY=http://proxy.test:8080"
    And the task output should contain "-e HTTPS_PROXY=https://proxy.test:8443"
    And the task output should contain "-e NO_PROXY=localhost,127.0.0.1"

  @proxy-without-vars
  Scenario: Proxy args are empty when no proxy env vars are set
    Given a clean temporary directory for "gitleaks/proxy" tests
    When the copier command is executed with default settings
    And I run task "gitleaks:proxy:debug" in the generated project
    Then the task output should contain "PROXY_ARGS="
    And the task output should not contain "-e HTTP_PROXY"
    And the task output should not contain "-e HTTPS_PROXY"
