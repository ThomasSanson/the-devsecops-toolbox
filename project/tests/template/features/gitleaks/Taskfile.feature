@gitleaks-taskfile @scaffolding @gitleaks
Feature: Gitleaks Taskfile uses docker cp/exec pattern
  As a DevSecOps engineer
  I want Gitleaks tasks to use docker cp and docker exec instead of volume mounts
  So that secret scanning works on platforms with remote Docker daemons (Kubernetes)

  @scan-full-docker-exec
  Scenario: Gitleaks scan-full task uses docker exec pattern
    Given a clean temporary directory for "gitleaks/taskfile" tests
    When the copier command is executed with default settings
    Then the task "scan-full" in file ".config/gitleaks/Taskfile.yml" should contain "docker exec"
    And the task "scan-full" in file ".config/gitleaks/Taskfile.yml" should contain "docker cp"

  @protect-docker-exec
  Scenario: Gitleaks protect task uses docker exec pattern
    Given a clean temporary directory for "gitleaks/taskfile" tests
    When the copier command is executed with default settings
    Then the task "protect" in file ".config/gitleaks/Taskfile.yml" should contain "docker exec"
    And the task "protect" in file ".config/gitleaks/Taskfile.yml" should contain "docker cp"

  @scan-branch-docker-exec
  Scenario: Gitleaks scan-branch task uses docker exec pattern
    Given a clean temporary directory for "gitleaks/taskfile" tests
    When the copier command is executed with default settings
    Then the task "scan-branch" in file ".config/gitleaks/Taskfile.yml" should contain "docker exec"
    And the task "scan-branch" in file ".config/gitleaks/Taskfile.yml" should contain "docker cp"

  @config-allowlist
  Scenario: Gitleaks config excludes cache, tmp and reports directories
    Given a clean temporary directory for "gitleaks/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/gitleaks/config.toml" should contain ".cache"
    And the file ".config/gitleaks/config.toml" should contain "tmp"
    And the file ".config/gitleaks/config.toml" should contain "megalinter-reports"
    And the file ".config/gitleaks/config.toml" should contain "node_modules"
    And the file ".config/gitleaks/config.toml" should contain "venv"
