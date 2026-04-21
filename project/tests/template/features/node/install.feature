@copier @scaffolding @node @install-script
Feature: Node install script uses nvm and a pinned version
  As a DevSecOps engineer
  I want the Node install script to use nvm with a version read from .config/node/version
  So that Node.js is reproducibly provisioned in user-space and automatically kept up to date by Renovate

  @node-install-nvm
  Scenario: Node install script installs Node.js via nvm at the pinned version
    Given a clean temporary directory for "node/install" tests
    When the copier command is executed with:
      | ci_platform | gitlab_saas |
    Then the file ".config/node/version" should contain "24."
    And the file ".config/node/install.sh" should contain "NODE_VERSION"
    And the file ".config/node/install.sh" should contain "SCRIPT_DIR"
    And the file ".config/node/install.sh" should contain "nvm install"
    And the file ".config/node/install.sh" should contain "nvm alias default"
    And the file ".config/node/install.sh" should NOT contain "apt-get install -y -qq nodejs"
    And the file ".config/node/install.sh" should NOT contain "deb.nodesource.com"
