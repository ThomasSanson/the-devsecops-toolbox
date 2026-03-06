@copier @python @python-version-source-of-truth
Feature: Python version source of truth
  As a DevSecOps engineer
  I want Python scripts and documentation to use the declared version file
  So that the toolbox does not drift away from .config/python/.python-version

  Scenario: Template source files read the declared Python version from the version file
    Then the source template file ".config/python/.python-version" should contain "3.14"
    And the source template file ".config/python3/install.sh" should contain "PYTHON_VERSION_FILE=\".config/python/.python-version\""
    And the source template file ".config/python3/install.sh" should contain "PYTHON_VERSION=\"$(cat \"$PYTHON_VERSION_FILE\")\""
    And the source template file ".config/uv/install.sh" should contain "uv python install \"$(cat .config/python/.python-version)\""
    And the source template file ".config/devcontainer/ubuntu/scripts/install-uv.sh" should contain "uv python install \"$(cat .config/python/.python-version)\""
    And the source template file "README.md" should contain ".config/python/.python-version"
    And the source template file "README.md" should contain "uv python install \"$(cat .config/python/.python-version)\""
    And the source template file "docs/guidelines/DevSecOps.md" should contain ".config/python/.python-version"
    And the source template file "docs/guidelines/DevSecOps.md" should contain "uv python install \"$(cat .config/python/.python-version)\""
