@bootstrap @devsecops @bootstrap-devsecops-installer
Feature: DevSecOps Toolbox Installer
  In order to easily set up a DevSecOps project from scratch
  As a developer on a fresh machine
  I want a standalone installer that sets up the toolchain and scaffolds the project

  Scenario: Documentation guard validates installer patterns in README
    Given the "README.md" file in the repository root
    Then it should contain the pattern "install.sh"
    And it should contain the pattern "curl"
    And it should contain the pattern "export PATH"
    And it should contain the pattern ".local/bin"

  Scenario: Installer script uses pinned tool versions
    Given the ".config/devsecops/install.sh" file in the repository root
    Then it should contain the pattern "TASK_VERSION="
    And it should contain the pattern "PYTHON_VERSION="
    And it should contain the pattern "COPIER_VERSION="
    And it should contain the pattern "TEMPLATE_URL="

  Scenario: Installer script requires a git repository
    Given the ".config/devsecops/install.sh" file in the repository root
    Then it should contain the pattern "git rev-parse"
    And it should contain the pattern "Not inside a git repository"

  Scenario: Installer script requires curl
    Given the ".config/devsecops/install.sh" file in the repository root
    Then it should contain the pattern "curl is required"

  Scenario: Installer script installs task and uv
    Given the ".config/devsecops/install.sh" file in the repository root
    Then it should contain the pattern "taskfile.dev/install.sh"
    And it should contain the pattern "astral.sh/uv/install.sh"

  Scenario: Installer script scaffolds project with Copier via uvx
    Given the ".config/devsecops/install.sh" file in the repository root
    Then it should contain the pattern "uvx"
    And it should contain the pattern "copier copy"
    And it should contain the pattern "Taskfile.yml"

  Scenario: Installer script delegates to task devsecops:init after scaffolding
    Given the ".config/devsecops/install.sh" file in the repository root
    Then it should contain the pattern "task devsecops:init"

  Scenario: Init Taskfile has prerequisites and configure tasks
    Given the ".config/devsecops/Taskfile.init.yml" file in the repository root
    Then it should contain the pattern "prerequisites"
    And it should contain the pattern "configure"
    And it should contain the pattern ":glab:merge-settings"
    And it should contain the pattern ":glab:renovate-token"
    And it should contain the pattern ":glab:commitizen-token"
    And it should contain the pattern ":glab:protected-branch"
