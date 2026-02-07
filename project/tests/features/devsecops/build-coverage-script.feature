@build-coverage-script
Feature: Build coverage script
  As a DevSecOps engineer
  I want the build coverage script to handle all Taskfile include types
  So that non-flatten includes don't crash the validation

  Scenario: Script processes non-flatten includes without crashing
    Given a minimal project with a non-flatten Taskfile include
    When the build coverage check is executed
    Then the build coverage check should succeed
