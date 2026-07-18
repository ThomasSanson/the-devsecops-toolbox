@e2e @release-window
Feature: task release opens the push window just long enough, then always closes it
  As a project maintainer
  I want `task release` to open push on main only for the release, and always
  close it again, even when the release push itself fails
  So that main stays locked outside of the release window.

  # ONE story, one continuous journey (no chapters): main starts locked, a
  # release run opens the push window just long enough to push, then closes it
  # again; the safety net proves the SAME close happens even when the push
  # itself fails (the `trap restore_branch_protection EXIT` in
  # Taskfile.release.yml). ONE Gherkin sentence = ONE card = ONE pixel baseline,
  # asserted inside the step (tolerance: 0); every verdict card twins its GitLab
  # page or terminal frame with a REST/log check of the same fact.
  Scenario: task release opens the push window just long enough to push, and always closes it
    Given main starts locked behind push protection
    When a release run opens the push window for maintainers
    And the release pushes the version bump to main
    Then the window closes again and push protection is restored
    And the safety net still closes the window when the push fails
