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
    # Note: A freshly initialized project: main is protected right away (merge for maintainers, push for no one).
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/repository
    Given main starts locked behind push protection
    # Note: task release opens push access for Maintainers just before it runs the version-bump step (Commitizen).
    # Copy: task release
    When a release run opens the push window for maintainers
    # Note: The version-bump step updates the version, and task release pushes it straight to main.
    # Copy: git -C <repo> log -1 --format='%s'
    And the release pushes the version bump to main
    # Note: task release turns push access back off when it exits, even after a successful push.
    # Copy: task release
    Then the window closes again and push protection is restored
    # Note: A second project, pointed at a host that doesn't exist: task release fails, but it still turns push access back off on the way out.
    # Copy: task release
    And the safety net still closes the window when the push fails
