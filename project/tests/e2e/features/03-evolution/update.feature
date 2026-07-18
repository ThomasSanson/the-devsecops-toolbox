@e2e @toolbox-update
Feature: A toolbox release arrives — copier update preserves my work
  As a maintainer of a project generated from the DevSecOps Toolbox
  I want `task copier:update` — the command Renovate runs automatically for
  every toolbox release — to apply the new release while keeping every edit
  I made
  So that upgrading the framework never destroys my customizations

  # ONE story in two chapters. ONE Gherkin sentence = ONE card = ONE pixel
  # baseline, asserted inside the step (tolerance: 0); every AFTER card twins
  # its frame with a filesystem check read straight from the project, so a
  # regression fails loud even without eyes.
  #
  # Chapter 1 runs in a REAL coloured terminal: a project generated from an
  # OLDER toolbox version, with its own spelling word crammed into the single
  # framework dictionary, receives the exact update Renovate triggers. The
  # dictionary splits into three files, the framework words stay in the
  # framework file, and the developer's own word moves to its own project file.
  # Chapter 2 shows the same promise from the render side: re-running the update
  # with a flipped answer (Ansible turned on) delivers the brand-new tooling the
  # release ships, while a file the developer hand-edited is left exactly as
  # they wrote it.
  Scenario: a toolbox update splits the dictionary, keeps my word, and spares my edits
    # Chapter: The update splits the dictionary and keeps my word
    Given a developer's project was generated from an earlier toolbox release
    And its spelling dictionary is a single framework-owned file
    And the developer has added their own word inside that shared file
    When the developer runs the toolbox update in the terminal
    Then the project now tracks the new toolbox release
    And its dictionary has been split into three files
    And the framework keeps its own words in its own file
    And the developer's own word has moved to a project-owned file
    And the shared file itself is now empty — it only imports the other two
    # Chapter: A flipped answer delivers new tools and spares my edits
    Given a project generated from an earlier toolbox release carries the developer's own edit
    And the project has no Ansible configuration yet
    When the developer re-runs the toolbox update and turns the Ansible option on
    Then the new Ansible tooling is delivered by the update
    And the developer's own edit survived the update untouched
