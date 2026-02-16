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

  @scan-branch-selective-copy-runtime
  Scenario: Gitleaks scan-branch task uses selective git archive copy
    Given a clean temporary directory for "gitleaks/taskfile" tests
    When the copier command is executed with default settings
    Then the task "scan-branch" in file ".config/gitleaks/Taskfile.yml" should contain "git ls-files -z --cached --others --exclude-standard"
    And the task "scan-branch" in file ".config/gitleaks/Taskfile.yml" should contain "tar --null -T - -cf - | docker cp -"
    And the task "scan-branch" in file ".config/gitleaks/Taskfile.yml" should contain "printf '.git\0'"
    And the task "scan-branch" in file ".config/gitleaks/Taskfile.yml" should NOT contain "docker cp {{.ROOT_DIR}}/. {{.TASK_GITLEAKS_CONTAINER_NAME}}:/path"

  @scan-branch-selective-copy-runtime
  Scenario: Selective git archive includes tracked and untracked but excludes ignored
    Given a clean temporary directory for "gitleaks/taskfile" tests
    When the copier command is executed with default settings
    And the project is initialized as a git repository
    And I create selective-copy fixtures in the generated project
    And I build the selective-copy archive in the generated project
    Then the selective-copy archive should contain "tracked.txt"
    And the selective-copy archive should contain "untracked.txt"
    And the selective-copy archive should contain ".git/"
    And the selective-copy archive should not contain "ignored.secret"
    And the selective-copy archive should not contain "ignored-dir/inside.txt"

  @scan-branch-selective-copy-runtime
  Scenario: Gitleaks scan-branch command runs successfully on generated project
    Given a clean temporary directory for "gitleaks/taskfile" tests
    When the copier command is executed with default settings
    And the project is initialized as a git repository
    And I create selective-copy fixtures in the generated project
    And I run task "gitleaks:scan-branch" in the generated project
    Then the task output should contain "Scanning commits from"
    And the task output should contain "No secrets detected in branch commits."

  @scan-branch-selective-copy-runtime
  Scenario: Gitleaks scan-branch fails when a committed secret is present
    Given a clean temporary directory for "gitleaks/taskfile" tests
    When the copier command is executed with default settings
    And the project is initialized as a git repository
    And I commit a tracked file containing a fake private key secret
    And I run task "gitleaks:scan-branch" in the generated project and capture the result
    Then the task should fail
    And the task output should contain "Gitleaks detected secrets in your branch commits!"

  @scan-branch-selective-copy-runtime
  Scenario: Gitleaks scan-branch ignores secrets stored in ignored files
    Given a clean temporary directory for "gitleaks/taskfile" tests
    When the copier command is executed with default settings
    And the project is initialized as a git repository
    And I create an ignored file containing a fake private key secret
    And I commit a safe change for branch scanning
    And I run task "gitleaks:scan-branch" in the generated project and capture the result
    Then the task should succeed
    And the task output should contain "No secrets detected in branch commits."

  @config-allowlist
  Scenario: Gitleaks config excludes cache, tmp and reports directories
    Given a clean temporary directory for "gitleaks/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/gitleaks/config.toml" should contain ".cache"
    And the file ".config/gitleaks/config.toml" should contain "tmp"
    And the file ".config/gitleaks/config.toml" should contain "megalinter-reports"
    And the file ".config/gitleaks/config.toml" should contain "node_modules"
    And the file ".config/gitleaks/config.toml" should contain "venv"
