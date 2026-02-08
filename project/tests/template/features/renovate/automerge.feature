@renovate @automerge @copier
Feature: Renovate Automerge Configuration
  As a DevSecOps engineer
  I want to control whether Renovate automatically merges updates for the DevSecOps Toolbox
  So that I can verify updates manually if needed

  Scenario: Renovate automerge is enabled by default
    Given a generated project from the Copier template
    Then the "config.json" file in the ".config/renovate" directory should contain the following properties in the "packageRules" array item matching "DevSecOps Toolbox":
      | Property          | Value        |
      | automerge         | true         |
      | platformAutomerge | true         |
      | automergeType     | pr           |
      | automergeStrategy | fast-forward |

  Scenario: Renovate automerge is disabled when requested
    Given a generated project from the Copier template with the following answers:
      | Question            | Answer |
      | devsecops_automerge | false  |
    Then the "config.json" file in the ".config/renovate" directory should NOT contain the following properties in the "packageRules" array item matching "DevSecOps Toolbox":
      | Property          |
      | automerge         |
      | platformAutomerge |
      | automergeType     |
      | automergeStrategy |
