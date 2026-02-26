@copier @scaffolding @jq @tool
Feature: Jq JSON Processor Tool
  As a DevSecOps engineer
  I want to have jq integrated in my project
  So that I can process JSON data from CLI tools

  @default
  Scenario: Generate project with jq configuration
    Given a clean temporary directory for "jq" tests
    When the copier command is executed with default settings
    Then the ".config/jq" directory should exist
    And the ".config/jq/install.sh" file should exist
