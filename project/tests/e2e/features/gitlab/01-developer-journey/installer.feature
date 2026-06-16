@e2e @e2e-journey @e2e-journey-installer
Feature: Developer journey — the working-branch installer scaffolds via Copier
  As a developer adopting the DevSecOps Toolbox
  I want to run the installer from my own machine and answer the Copier questions
  So that the project is scaffolded from the toolbox version I am actually testing

  @e2e-journey-installer-full
  Scenario: Onboarding from a blank repo through the working-branch installer
    Given a GitLab runs in a container configured with user "lambda"
    And a fresh Ubuntu web terminal cloned from a freshly created blank GitLab project
    And the working-branch installer is staged in the terminal

    # Stage 2 — the developer sees the install command before running it
    When I type the toolbox installer command in the terminal
    Then the developer terminal should visually match "gitlab/01-developer-journey/install-command-terminal"

    # Stage 2b — the FIRST decision (gum/glow layer): install everything?
    When I launch the installer and wait for the prompt "Install the complete DevSecOps framework?"
    Then the terminal from "Install the complete DevSecOps framework?" should visually match "gitlab/01-developer-journey/install-scope-terminal"

    # Stage 2c — accepting installs the complete framework; scaffolding from the
    # WORKING-BRANCH template. The toolchain version/download lines are
    # non-deterministic (verified on the log below); this captures the
    # deterministic setup/scaffold milestone block.
    When I choose to install the complete framework
    And I wait for the prompt "Template source: /tmp/toolbox-template"
    Then the milestone block from "Setting up project" for 3 lines should visually match "gitlab/01-developer-journey/scaffold-step-terminal"

    # Stage 3 — the Copier questionnaire, one visual baseline per question
    When I wait for the prompt "Do you need Ansible?"
    Then the terminal from "Do you need Ansible?" should visually match "gitlab/01-developer-journey/copier-ansible-terminal"

    When I accept the default and wait for the prompt "Which CI/CD platform are you using?"
    Then the terminal from "Which CI/CD platform are you using?" should visually match "gitlab/01-developer-journey/copier-ci-platform-terminal"

    When I accept the default and wait for the prompt "Which container runtime would you like to use?"
    Then the terminal from "Which container runtime would you like to use?" should visually match "gitlab/01-developer-journey/copier-runtime-terminal"

    When I accept the default and wait for the prompt "Generate a docker-compose.yml file"
    Then the terminal from "Generate a docker-compose.yml file" should visually match "gitlab/01-developer-journey/copier-compose-terminal"

    When I accept the default and wait for the prompt "Enable the project workspace?"
    Then the terminal from "Enable the project workspace?" should visually match "gitlab/01-developer-journey/copier-workspace-terminal"

    When I accept the default and wait for the prompt "Auto-merge Renovate merge requests"
    Then the terminal from "Auto-merge Renovate merge requests" should visually match "gitlab/01-developer-journey/copier-automerge-terminal"

    When I accept the default and wait for the prompt "Language for Gherkin test specifications"
    Then the terminal from "Language for Gherkin test specifications" should visually match "gitlab/01-developer-journey/copier-gherkin-terminal"

    # Stage 3 end — scaffolding completes (proven on the log: the success line
    # scrolls out of view as `task devsecops:init` floods the terminal)
    When I accept the last default and wait for scaffolding to complete

    # Toolchain + scaffolding milestones are verified on the full session log
    # (non-deterministic versions/temp-dirs make them unfit for a pixel baseline)
    Then the install log should contain "Installing toolchain"
    And the install log should contain "task v3.49.1 installed"
    And the install log should contain "Scaffolding project with Copier"
    And the install log should contain "Template source: /tmp/toolbox-template"
    # The 257-file create list is too long for one pixel baseline; verified here
    And the install log should report at least 200 created files
    And the install log should contain "Your DevSecOps project has been created successfully!"
    And the install log should contain "scaffolded successfully"
