@e2e
Feature: The release closes the door to main behind it, every single time
  As the person who has to trust whatever lands on main
  I want the release to be the only thing that ever pushes to main, and only
  for the few seconds its push takes
  So that main can never be left open for just anyone to push to unreviewed —
  not even when a release crashes or its job is killed halfway through.

  # WHAT THIS IS ABOUT, in plain terms.
  #
  # main is the one branch nobody may push to. Every change has to go through a
  # reviewed merge request — that rule is what keeps unreviewed code off the
  # release branch.
  #
  # The release is the single exception. To publish a new version it must write
  # the version bump straight onto main. So it briefly OPENS the door, pushes,
  # and CLOSES it again — a window that lasts only a few seconds.
  #
  # THE DANGER we guard against: a release that stops halfway — it crashes, or
  # its CI job is cancelled or times out — could leave that door OPEN. main
  # would then quietly accept direct, unreviewed pushes from anyone, and nobody
  # would notice. That must never happen.
  #
  # This story walks the whole promise in order: the door starts CLOSED, opens
  # ONLY for the push, closes again on success — and, the part that matters
  # most, closes even when the release DIES, whether it crashes or is killed.
  #
  # ONE sentence = ONE card = ONE pixel baseline (tolerance: 0); each card twins
  # its GitLab page or terminal frame with a REST/log check of the same fact.
  @release-window
  Scenario: the release opens main's door only to push, and always shuts it again
    # Note: The safe resting state, straight after setup. On GitLab, main's protection reads "Allowed to push: No one". Whenever nobody is releasing, this is exactly how it must look: not one person can push to main directly — every change comes through a reviewed merge request.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/repository
    Given main's door is closed to everyone
    # Note: A release starts. Because it has to write to main, its very first move is to open the door: protection flips to "Allowed to push: Maintainers". This is the ONLY moment the door is ever open, and only for the few seconds the push needs.
    # Copy: task release
    When the release opens the door just long enough to push
    # Note: With the door open, the release does the single thing it exists to do: it writes the new version straight onto main, with no merge request. This one push is the whole reason the door has to open at all.
    # Copy: git -C <repo> log -1 --format='%s'
    And it makes its one write to main
    # Note: The happy path ends here. The release's last act is to close the door again — protection goes back to "Allowed to push: No one". The door was open only between the previous card and this one.
    # Copy: task release
    Then it closes the door again the moment it is done
    # Note: Now the dangerous case. This release is deliberately made to CRASH in the middle of its push (its push target does not exist). A safety net still closes the door on the way out — so a release that fails can never leave main open.
    # Copy: task release
    And a crash still cannot leave the door open
    # Note: The other way a release dies: the job is KILLED — a person cancels it, or CI times it out — right while the door is open. The same safety net still runs. Here is main's protection page AFTER the kill: "Allowed to push: No one" again. The door is shut — exactly the hole we refuse to ever leave open.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/repository
    And a killed job still cannot leave the door open
