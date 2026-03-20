@bootstrap @devsecops @commitlint @bootstrap-devsecops-commitlint-ready-e2e
Feature: Commitlint dependencies are ready after local-path bootstrap
  In order to commit immediately after project bootstrap
  As a developer using the toolbox template
  I want commitlint dependencies to be available for commit hooks on the first commit

  @ubuntu @docker
  Scenario: First commit succeeds after local-path copier bootstrap in dedicated containers
    Given the GitLab test stack is started with docker compose
    And a fresh Ubuntu docker container is running on the GitLab test network
    And the packages "git curl unzip python3 python3-pip" are installed in the container
    And a git repository is initialized at "/workspace/my-project" in the container
    And a GitLab remote project "bootstrap-commitlint-ready" is configured for "/workspace/my-project" in the container
    And the local directory "." is copied into the container at "/tmp/toolbox-template"
    When I run "set -eu; cd /tmp/toolbox-template; bash .config/task/install.sh; python3 -m pip install --break-system-packages --user copier==9.14.0" from "/" in the container
    Then the command should exit with code 0
    When I run "set -eu; export PATH=\"$HOME/.local/bin:$PATH\"; copier copy --trust --defaults --vcs-ref=HEAD --overwrite /tmp/toolbox-template ." from "/workspace/my-project" in the container
    Then the command should exit with code 0
    When I run "set -eu; export PATH=\"$HOME/.local/bin:$HOME/go/bin:$PATH\"; git add .; if ! TASK_GITLEAKS_ENABLED=false git commit --allow-empty -m \"feat: bootstrap commitlint readiness\" >/tmp/first-commit.log 2>&1; then cat /tmp/first-commit.log; exit 1; fi; cat /tmp/first-commit.log" from "/workspace/my-project" in the container
    Then the command should exit with code 0
    And the command output should contain "Commit message passed Commitizen checks."
    And the command output should contain "Commit message passed commitlint."
    When the command output is displayed in the browser
    Then the terminal output should visually match "bootstrap-commitlint-ready-success"
