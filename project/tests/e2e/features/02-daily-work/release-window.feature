@e2e
Feature: main is locked for everyone, yet the release still manages to write on it
  As a project maintainer
  I want the release to be the only thing that can ever push to main, and only
  for the few seconds its push takes
  So that the lock protecting main never depends on someone remembering to
  re-arm it.

  # WHY this story exists. The toolbox locks main completely: nobody pushes,
  # every change arrives through a reviewed merge request. But the release
  # itself HAS to push — it writes the version-bump commit and the tag straight
  # onto main. Those two rules collide, and the framework resolves the clash
  # with a "push window": `task release` flips main's protection open just
  # before pushing and flips it back the moment it is done. The dangerous case
  # is the CRASH — a release that dies halfway must not leave main unlocked, so
  # the close also runs from a shell trap on the way out, whatever happened.
  # This story proves all four moments: locked before, open only during, locked
  # after, and locked again even when the release fails.
  #
  # ONE story, one continuous journey (no chapters). ONE Gherkin sentence = ONE
  # card = ONE pixel baseline, asserted inside the step (tolerance: 0); every
  # verdict card twins its GitLab page or terminal frame with a REST/log check
  # of the same fact.
  @release-window
  Scenario: task release opens the push window just long enough to push, and always closes it
    # Note: The starting point, straight after init: GitLab's protected-branches page shows main with "Allowed to push: No one". Nobody — not even a maintainer — can write to main directly; changes only arrive through merge requests.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/repository
    Given main starts locked behind push protection
    # Note: The release begins and hits the collision this story is about: it must push a version bump to a branch nobody may push to. So its first move is to open the window — protection flips to "Allowed to push: Maintainers", for the duration of the release only.
    # Copy: task release
    When a release run opens the push window for maintainers
    # Note: With the window open, the release does the one write main ever receives directly: the version-bump commit lands on main without a merge request — this push is the whole reason the window exists.
    # Copy: git -C <repo> log -1 --format='%s'
    And the release pushes the version bump to main
    # Note: The release's last act before leaving: protection flips back to "Allowed to push: No one". The window only ever stays open for the seconds between the previous card and this one.
    # Copy: task release
    Then the window closes again and push protection is restored
    # Note: The proof that matters most: a second release is made to CRASH mid-push (its remote points at a host that does not exist). The shell trap still closes the window on the way out — a failed release can never leave main unlocked.
    # Copy: task release
    And the safety net still closes the window when the push fails
