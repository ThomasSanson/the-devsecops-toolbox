@copier @scaffolding @default
Feature: Project Scaffolding
  As a DevSecOps engineer
  I want to generate a project from a Copier template
  So that I can quickly start with the correct structure and configuration

  Scenario: Generated project has valid structure and configuration
    Given a generated project from the Copier template
    # Core files
    Then the generated project directory should exist
    And the ".copier-answers.yml" file should exist in the ".config/devsecops" directory
    And the "VERSION" file should exist in the "." directory
    And the "LICENSE" file should exist in the "." directory
    # Excluded template artifacts
    And the following files should NOT exist:
      | File Path  |
      | copier.yml |
    And the following directories should NOT exist:
      | Directory Path     |
      | .agent             |
      | .cache             |
      | .config/**/roles   |
      | .vscode            |
      | megalinter-reports |
      | node_modules       |
      | project/tests      |
      | tmp                |
      | venv               |
    # Tool configurations
    And the ".config/glab/install.sh" file should exist
    # Commitizen configuration
    And the commitizen configuration file ".config/commitizen/cz.yaml" should exist
    And the commitizen configuration should have the version "0.1.0"
    And the commitizen "version_files" configuration should NOT contain ".gitlab-ci.yml"

