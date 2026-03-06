@copier @python @python-version-sudo
Feature: Python version installation with sudo
  As a DevSecOps engineer
  I want the Python bootstrap to elevate automatically when needed
  So that the declared Python version is installed during setup

  Scenario: Source template installs the declared Python version with sudo when needed
    Then the source template file ".config/python3/install.sh" should contain "sudo env PATH=\"$PATH\" sh \"$0\""
    And the source template file ".config/python3/install.sh" should contain "uv python install --install-dir \"$UV_PYTHON_INSTALL_DIR\" \"$PYTHON_VERSION\""
    And the source template file ".config/python3/install.sh" should contain "uv python find \"$PYTHON_VERSION\""
