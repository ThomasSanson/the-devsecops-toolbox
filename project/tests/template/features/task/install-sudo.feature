@copier @task @task-install-sudo
Feature: Taskfile install with sudo support
  As a DevSecOps engineer
  I want the Taskfile install script to handle permission issues
  So that it can reinstall a pinned version even when the existing binary is owned by root

  Scenario: Install script removes existing binary with passwordless sudo before reinstalling
    Then the source template file ".config/task/install.sh" should contain "sudo -n rm"
    And the source template file ".config/task/install.sh" should contain "cat \"$SCRIPT_DIR/version\""
