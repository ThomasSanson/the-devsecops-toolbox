@copier @renovate @template
Feature: Renovate plugin-only configuration
  As a DevSecOps engineer
  I want the generated project to include a minimal Renovate configuration
  So that only the DevSecOps toolbox version is updated via Copier answers

  Scenario: Generated project includes Renovate plugin-only config
    Given a generated project for "renovate/config" tests
    Then the generated project directory should exist
    And the ".config/renovate/config.json" file should exist
    And the content of the file ".config/renovate/config.json" should contain:
      """
      "matchManagers": ["copier"]
      """
    And the content of the file ".config/renovate/config.json" should contain:
      """
      "matchFileNames": ["project/**"]
      """
    And the content of the file ".config/renovate/config.json" should contain:
      """
      "git checkout -- . && git clean -fd && task copier:update TASK_COPIER_CLI_OPTS='--trust --skip-answered --defaults --vcs-ref {{{newVersion}}}'"
      """
