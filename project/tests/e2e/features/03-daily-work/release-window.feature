@e2e @e2e-release-toggle
Feature: task release toggles the push protection window
  As a project maintainer
  I want `task release` to temporarily open push on main and ALWAYS close it back
  Even when the release push itself fails
  So that main stays locked outside of the release window.

  # ONE storyboard: the release push window as one continuous journey — main
  # starts locked, a release run opens the window just long enough to push,
  # then closes it again; the safety net proves the SAME close happens even
  # when the push itself fails (the `trap restore_branch_protection EXIT` in
  # Taskfile.release.yml). ONE Gherkin sentence = ONE storyboard card = ONE
  # pixel baseline (tolerance: 0); every verdict card twins its GitLab page
  # or <pre> frame with a programmatic REST/log assert of the same fact.
  @e2e-release-window
  Scenario: task release opens the push window just long enough to push, and always closes it
    Given main starts locked behind push protection
    When a release run opens the push window for maintainers
    And the release pushes the version bump to main
    Then the window closes again and push protection is restored
    And the safety net still closes the window when the push fails
