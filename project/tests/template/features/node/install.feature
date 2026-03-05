@copier @scaffolding @node @install-script
Feature: Node install script resilience
  As a DevSecOps engineer
  I want the Node install script to retry apt operations
  So that transient mirror sync errors do not break builds

  @node-install-retry
  Scenario: Node install script retries apt update/install
    Given a clean temporary directory for "node/install" tests
    When the copier command is executed with:
      | ci_platform | gitlab_saas |
    Then the file ".config/node/install.sh" should contain "retry_cmd() {"
    And the file ".config/node/install.sh" should contain "Attempt ${attempt}/${max_attempts} failed"
    And the file ".config/node/install.sh" should contain "rm -rf /var/lib/apt/lists/*"
    And the file ".config/node/install.sh" should contain "retry_cmd \"apt-get update -qq\""
    And the file ".config/node/install.sh" should contain "retry_cmd \"apt-get install -y -qq nodejs\""
    And the file ".config/node/install.sh" should contain "install_node_from_distro_repo() {"
    And the file ".config/node/install.sh" should contain "NodeSource repository install failed after retries. Falling back to distro packages."
    And the file ".config/node/install.sh" should contain "retry_cmd \"apt-get install -y -qq nodejs npm\""
