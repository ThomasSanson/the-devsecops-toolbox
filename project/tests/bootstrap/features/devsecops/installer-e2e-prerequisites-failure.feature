@bootstrap @devsecops @bootstrap-devsecops-installer
Feature: DevSecOps Toolbox Installer — auto-installs prerequisites then fails without Git linkage
  In order to trust the installer from a fresh machine
  As a developer
  I want the installer to auto-install missing prerequisites and fail cleanly without a GitLab remote

  @ubuntu @docker @bootstrap-devsecops-installer-prerequisites-failure-e2e
  Scenario: Fresh Ubuntu end-to-end run auto-installs prerequisites then fails without Git linkage
    Given I set docker container name to "test-bootstrap-e2e"
    And I run host commands:
      """
      docker rm -f test-bootstrap-e2e >/dev/null 2>&1 || true
      docker run -d --name test-bootstrap-e2e ubuntu:24.04 bash -c "while :; do sleep 10 & wait; done"
      docker cp .config/devsecops/install.sh test-bootstrap-e2e:/tmp/install.sh
      docker exec test-bootstrap-e2e mkdir -p /tmp/toolbox-template
      docker cp ./. test-bootstrap-e2e:/tmp/toolbox-template
      docker exec test-bootstrap-e2e sh -c "apt-get update -qq && apt-get install -y -qq sudo curl"
      docker exec test-bootstrap-e2e sh -c "id bootstrap >/dev/null 2>&1 || useradd -m -s /bin/bash bootstrap"
      docker exec test-bootstrap-e2e sh -c "printf '%s\n' 'bootstrap ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/bootstrap && chmod 0440 /etc/sudoers.d/bootstrap && mkdir -p /workspace && chown -R bootstrap:bootstrap /workspace && chown bootstrap:bootstrap /tmp/install.sh && chown -R bootstrap:bootstrap /tmp/toolbox-template"
      docker exec -u bootstrap test-bootstrap-e2e sh -c "id -un"
      """
    Then the command should exit with code 0
    And the command output should contain "bootstrap"
    When I run host commands:
      """
      docker exec -u bootstrap -e DEVSECOPS_TEMPLATE_URL=/tmp/toolbox-template test-bootstrap-e2e sh -c "mkdir -p /workspace/my-project && cd /workspace/my-project && yes '' | head -n 40 | bash /tmp/install.sh"
      """
    Then the command output should contain "🚀 DevSecOps Toolbox Installer"
    And the command output should contain "task devsecops:init failed. Attempting to install missing prerequisites..."
    And the command output should contain "Installing unzip with sudo..."
    And the command output should contain "No GitLab repository remote was detected."
    And the command should fail
    And the command output is displayed in the browser
    Then the terminal output should visually match "fresh-ubuntu-install-script-prerequisites-failure"
