@test-coverage-script
Feature: Test coverage script
  As a DevSecOps engineer
  I want the test coverage script to detect missing CI test jobs
  So that no test task is forgotten when splitting CI jobs

  Scenario: Script succeeds when all test tasks have CI jobs
    Given a minimal project with test tasks and matching CI jobs
    When the test coverage check is executed
    Then the test coverage check should succeed

  Scenario: Script fails when a test task is missing from CI
    Given a minimal project with a test task missing from CI
    When the test coverage check is executed
    Then the test coverage check should fail
    And the test coverage output should contain "project:test:security"
