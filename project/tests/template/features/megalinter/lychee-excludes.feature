@megalinter-lychee-excludes @megalinter @scaffolding
Feature: MegaLinter Lychee excludes for generated artifacts
  As a DevSecOps engineer
  I want Lychee to ignore generated and cache directories
  So that link checks do not fail on transient test artifacts

  Scenario: Generated project excludes _output from MegaLinter directories
    Given a generated project for "megalinter/lychee-excludes" tests
    Then the file ".config/megalinter/config.base.yml" should contain "EXCLUDED_DIRECTORIES:"
    And the file ".config/megalinter/config.base.yml" should contain "- _output"

  Scenario: Generated project excludes _output for Kingfisher scanning
    Given a generated project for "megalinter/lychee-excludes" tests
    Then the file ".config/megalinter/config.base.yml" should contain "--exclude=_output"

  Scenario: Source template keeps Lychee excludes in Jinja base config
    Given a generated project for "megalinter/lychee-excludes" tests
    Then the source template file ".config/megalinter/config.base.yml.jinja" should contain "- _output"
    And the source template file ".config/megalinter/config.base.yml.jinja" should contain "--exclude=_output"
