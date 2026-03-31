@copier @devsecops @gherkin-language
Feature: Gherkin language configuration
  As a DevSecOps engineer
  I want to choose the Gherkin language for my test specifications
  So that my team can write tests in their preferred language

  Scenario: Default Gherkin language is English
    Given a generated project from the Copier template
    Then the content of the file ".agent/rules/tests-structure.md" should contain:
      """
      Gherkin in **en**
      """

  Scenario: Gherkin language can be set to French
    Given a generated project from the Copier template with the following answers:
      | Question         | Answer |
      | gherkin_language | fr     |
    Then the content of the file ".agent/rules/tests-structure.md" should contain:
      """
      Gherkin in **fr**
      """
