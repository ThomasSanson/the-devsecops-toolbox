@copier @scaffolding @project-setup @template
Feature: Project Scaffolding
  As a DevSecOps engineer
  I want to generate a project from a Copier template
  So that I can quickly start with the correct structure and configuration

  Scenario: Generating a new project from template
    Given a clean temporary directory for tests
    When the copier command is executed to generate a project from the template
    Then the generated project directory should exist

  Scenario: Verify core Copier artifact presence
    Then the ".copier-answers.yml" file should exist in the ".config/devsecops" directory

  Scenario: Verify core VERSION presence
    Then the "VERSION" file should exist in the "." directory

  Scenario: Verify core LICENSE presence
    Then the "LICENSE" file should exist in the "." directory

  Scenario: Verify excluded files are absent
    Then the following files should NOT exist:
      | File Path  |
      | copier.yml |

  Scenario: Verify excluded directories are absent
    Then the following directories should NOT exist:
      | Directory Path         |
      | .cache                 |
      | .config/**/roles       |
      | .vscode                |
      | megalinter-reports     |
      | node_modules           |
      | project/plugin         |
      | tmp                    |
      | venv                   |

  Scenario: Verify Commitizen configuration
    Then the commitizen configuration file ".config/commitizen/cz.yaml" should exist
    And the commitizen configuration should have the version "0.1.0"
    And the commitizen "version_files" configuration should NOT contain ".gitlab-ci.yml"

  Scenario: Running a DevSecOps task in the generated project
    Given a project has been generated with the DevSecOps plugin
    When I execute the DevSecOps task
    Then the DevSecOps task should complete successfully
