@e2e @e2e-init-guidance
Feature: Developer journey — when something is wrong, init tells you exactly what to fix
  As a developer setting up the DevSecOps Toolbox
  I want `task devsecops:init` to stop and name the next command to run
  When my GitLab setup is not ready — or to finish cleanly when I turn GitLab off
  So that I am never left guessing what to run next

  # The guidance family, merged into ONE storyboard: three situations one
  # developer can hit, each proven by init's OWN verdict. Each verdict runs in
  # its own fresh project (a throwaway Ubuntu container with the toolbox), so
  # the frames never bleed setup state into each other.
  #
  # ONE sentence = ONE storyboard card = ONE pixel baseline, asserted inside the
  # step (tolerance: 0): the captured init output is filtered of volatile
  # install noise, anchored on its remediation marker and rendered to a dark
  # <pre>. Each verdict card pairs its frame with a programmatic twin — the same
  # fact asserted on the captured stdout/exit code — so a regression fails loud
  # even without eyes. The storyboard SVG (selectable, copyable text around the
  # untouched frames, including the command that replays this scenario) is
  # assembled automatically when the scenario ends.
  #
  # Note: the opt-out env var is TASK_GLAB_ENABLED=false (the real gate in
  # .config/glab/Taskfile.yml — every glab task skips on it), carried in the
  # card's copy field.
  @e2e-init-guidance-verdicts
  Scenario: init guides the developer through every misconfigured start
    Given a developer's new project points at a GitLab remote the CLI never signed into
    Then running init stops and shows the exact GitLab sign-in command to run
    Then turning the GitLab integration off lets init finish cleanly
    When another developer's project points at a GitHub remote instead
    Then init refuses the non-GitLab remote and shows how to fix it
