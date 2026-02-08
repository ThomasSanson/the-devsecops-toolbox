@megalinter @kingfisher @scaffolding @remove-bun
Feature: Kingfisher excludes node_modules
  As a DevSecOps engineer
  I want Kingfisher to exclude node_modules directories
  So that secret scanning does not flag false positives from npm dependencies

  Scenario: Generated project Kingfisher config excludes node_modules
    Given a generated project from the Copier template
    Then the file ".config/megalinter/config.yml" should contain "--exclude=node_modules"
