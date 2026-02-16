@megalinter-inheritance @megalinter
Feature: Megalinter Configuration Architecture
  As a Developer
  I want the configuration structure to follow an inheritance model
  So that I can separate template configuration from project configuration

  Scenario: Verify configuration file structure
    Given a generated project for "megalinter/inheritance" tests
    When I check the Megalinter configuration
    Then the file ".config/megalinter/config.base.yml" should exist
    And the file ".config/megalinter/config.yml" should exist
    And the file ".config/megalinter/config.yml" should contain "EXTENDS: .config/megalinter/config.base.yml"

  Scenario: Append mode configuration
    Given a generated project for "megalinter/inheritance" tests
    When I check the Megalinter base configuration
    Then the file ".config/megalinter/config.base.yml" should contain "CONFIG_PROPERTIES_TO_APPEND"
    And the file ".config/megalinter/config.base.yml" should contain "REPOSITORY_KINGFISHER_ARGUMENTS" in the list of properties to append

  Scenario: Functional verification of inheritance
    Given a generated project for "megalinter/inheritance" tests
    When I append the following content to the file ".config/megalinter/config.yml":
      """
      # Disable linters that fail in test environment (e.g. git diff, markdown)
      DISABLE_LINTERS:
        - ANSIBLE_ANSIBLE_LINT
        - COPYPASTE_JSCPD
        - JSON_V8R
        - YAML_V8R
        - MARKDOWN_MARKDOWNLINT
        - REPOSITORY_GIT_DIFF

      """
    And I run task "megalinter:npx" in the generated project
    Then the task output should contain "MegaLinter (npx) analysis completed successfully"
