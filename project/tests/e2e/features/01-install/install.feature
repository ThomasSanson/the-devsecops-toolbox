@e2e @install-complete
Feature: The whole install, from an empty project to a locked-down GitLab
  As a developer adopting the DevSecOps Toolbox
  I want to run the installer, answer its questions, and see the framework land
  through a review with GitLab safely configured
  So that one story proves the entire first install, end to end

  # The flagship story: ONE interactive install in a real terminal (ttyd) builds
  # ONE project, and every GitLab proof below is read from THAT same project.
  # ONE Gherkin sentence = ONE card = ONE pixel baseline, asserted inside the
  # step (tolerance: 0); each terminal card is anchored on the typed command, and
  # each GitLab card twins its masked page with a REST check of the same fact, so
  # a regression fails loud even without eyes. Set up off-camera: the test user,
  # the blank cloned project, the staged working-branch installer, the tools it
  # needs, and the GitLab login. A merge request is the page where changes get
  # reviewed before joining main.
  #
  # Chapter 1 walks the whole Copier questionnaire, one card per question, to the
  # finished screen and the scaffolded project. Chapter 2 shows how the framework
  # arrives — as a merge request from init-framework-devsecops into main, never a
  # forced push. Chapter 3 shows the GitLab project init locked and wired:
  # fast-forward-only merges, no direct pushes to main, the automation token, and
  # that token saved as a CI/CD variable.
  Scenario: One interactive install builds the framework and configures GitLab
    # Chapter: Answer the questions, build the framework
    Given a developer has just cloned a brand-new empty project into the terminal
    When the developer starts the toolbox installer
    And the developer keeps the complete framework and the first question asks about Ansible
    And the developer keeps GitLab as the CI/CD platform
    And the developer keeps Docker as the container runtime
    And the developer keeps the generated docker-compose file
    And the developer keeps the project workspace enabled
    And the developer keeps Renovate auto-merge enabled
    And the developer keeps English as the Gherkin language
    Then the installer builds the project and shows the finished screen
    And the project folder now holds the full DevSecOps framework
    # Chapter: The framework arrives as a merge request
    Then a merge request into main is now waiting for review on GitLab
    And GitLab now lists main and the new init-framework-devsecops branch
    # Chapter: GitLab is locked and wired
    Then GitLab now lets main accept only fast-forward merges
    And GitLab now refuses pushes straight to main
    And GitLab now holds an automation token for the project
    And GitLab now keeps that token as a CI/CD variable
