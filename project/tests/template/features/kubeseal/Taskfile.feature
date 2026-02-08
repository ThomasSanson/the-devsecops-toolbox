@copier @scaffolding @kubeseal
Feature: Kubeseal Taskfile
  As a DevSecOps engineer
  I want a standard Taskfile for Kubeseal
  So that I can manage sealed secrets consistently

  @default
  Scenario: Check Kubeseal Taskfile existence
    Given a clean temporary directory for "kubeseal/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/kubeseal/Taskfile.yml" should exist
