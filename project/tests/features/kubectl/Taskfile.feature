@kubectl-taskfile @scaffolding @taskfile
Feature: Kubectl Taskfile Standardization
  As a DevSecOps engineer
  I want a standard Taskfile for Kubectl operations
  So that I can use consistent commands and documentation

  @default
  Scenario: Verify Kubectl Taskfile documentation
    Given a clean temporary directory for "kubectl/taskfile" tests
    When the copier command is executed with default settings
    Then the file ".config/kubectl/Taskfile.yml" should exist
    And the file ".config/kubectl/Taskfile.yml" should contain "desc: 📥 Install kubectl using Ansible automation"
    And the file ".config/kubectl/Taskfile.yml" should contain "desc: 🔌 Port-forward a Kubernetes service to localhost"
    And the file ".config/kubectl/Taskfile.yml" should contain "desc: 📊 Check status of all pods in all namespaces"
