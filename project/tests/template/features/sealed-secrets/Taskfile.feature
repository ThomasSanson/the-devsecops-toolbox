@copier @scaffolding @sealed-secrets
Feature: Sealed Secrets Taskfile
  As a DevSecOps engineer
  I want a standard Taskfile for Sealed Secrets
  So that I can manage secrets consistently

  @default
  Scenario: Check Sealed Secrets Taskfile existence
    Given a clean temporary directory for "sealed-secrets/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/sealed-secrets/Taskfile.yml" should exist
