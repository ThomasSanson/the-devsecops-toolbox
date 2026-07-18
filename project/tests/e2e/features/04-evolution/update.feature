# cspell:ignore Caddyfile
# (Caddyfile is the generated project's own dictionary word in the journey below.)
@e2e @e2e-toolbox-update
Feature: A toolbox release arrives — copier update preserves my work
  As a maintainer of a project generated from the DevSecOps Toolbox
  I want `task copier:update` — the command Renovate runs automatically for
  every toolbox release — to apply the new release while keeping every edit
  I made
  So that upgrading the framework never destroys my customizations

  # ONE Gherkin sentence = ONE storyboard card = ONE pixel baseline, asserted
  # inside the step (tolerance: 0). The SVG — selectable captions and the exact
  # commands around the untouched frames — is assembled when the scenario ends.
  # The journey is shown in a REAL coloured ttyd terminal: a project generated
  # from an OLDER toolbox version, its own spelling word crammed into the single
  # framework dictionary, receives the exact update Renovate triggers
  # (`task copier:update`). The dictionary splits, the framework words stay in
  # the framework file and the developer's word moves to its own project file —
  # every AFTER card twins its frame with a filesystem assert read straight from
  # the container, so a regression fails loud even without eyes.
  @e2e-toolbox-update-journey
  Scenario: the toolbox update splits the dictionary yet keeps the developer's own word
    Given a developer's project was generated from an earlier toolbox release
    And its spelling dictionary is a single framework-owned file
    And the developer has added their own word inside that shared file
    When the developer runs the toolbox update in the terminal
    Then the project now tracks the new toolbox release
    And its dictionary has been split into three files
    And the framework keeps its own words in its own file
    And the developer's own word has moved to a project-owned file
    And the shared file itself is now empty — it only imports the other two

  # Same promise from the render side: re-running the update with a FLIPPED
  # answer (Ansible turned on) delivers the brand-new tooling the release ships,
  # while a file the developer hand-edited (a copier skip-if-exists "keep my
  # file") is left exactly as they wrote it. Each card renders the real command
  # output on the freshly updated project and twins it with a filesystem assert.
  @e2e-toolbox-update-options
  Scenario: re-running the update with a flipped answer delivers new files and spares customizations
    Given a project generated from an earlier toolbox release carries the developer's own edit
    And the project has no Ansible configuration yet
    When the developer re-runs the toolbox update and turns the Ansible option on
    Then the new Ansible tooling is delivered by the update
    And the developer's own edit survived the update untouched
