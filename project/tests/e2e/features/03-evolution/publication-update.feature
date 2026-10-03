@e2e
Feature: A toolbox release reaches a project that installed only source publication
  As a team that took one component instead of the whole framework
  I want a new toolbox release to update that component and the little that
  carries it, and nothing else
  So that the rules deciding what becomes public never go stale, and never
  come back to a project that did not ask for them

  # A component installed on its own would be a dead copy: no version, no way to
  # learn a new release exists, no way to apply it. So the install keeps the
  # framework's OWN update machinery rather than inventing a second one. It is
  # the copier answers file that records
  # the template and the version, the handful of files `task copier:update` needs
  # to run, the Renovate config that watches that answers file, and the component.
  #
  # This story runs a real toolbox release against a real GitLab. The new version
  # tightens the publication floor, touches the update machinery itself, and
  # changes a tool the project never installed. Nobody types the update: the
  # feedback phase runs Renovate, Renovate opens the merge request and applies
  # the release inside it, and the story reads back what moved once it is merged
  # — the version, the framework's files, and nothing else. The rules the team
  # wrote themselves are still theirs.
  @publication-update
  Scenario: the release updates the component and its spine, spares the team's rules, and brings nothing else
    # Note: A project that ticked source publication on the installer's checklist and nothing else. Its own README and src are there; the install added .config, .env.dist, .gitlab-ci.yml and Taskfile.yml. The last line is the release they came from.
    # Note: What is NOT there is the point: no linter, no container runtime, no forge tooling, and not even the phase orchestrators a full project gets. Only what runs the publication and what keeps it up to date.
    # Copy: ls -A1 && ls .config && grep _commit .config/devsecops/.copier-answers.yml
    Given a project that installed source publication and nothing else
    # Note: What the project would publish today. Three files, and among them src/cluster.kubeconfig, a cluster credential that nobody thought to deny.
    # Note: Remember this list. The same command answers differently four cards from here, without anyone touching a single rule.
    # Copy: task publication:check
    And what it would publish today, cluster credential included
    # Note: The test runs task feedback directly. Renovate reads the release recorded in the answers file, checks the template, and finds 1.0.1. This proves the update task; execution by GitLab's nightly schedule needs a separate CI test.
    # Note: This is the real thing, against the real GitLab in the picture below. The last lines are Renovate saying it opened a merge request.
    # Copy: task feedback
    When the feedback task runs and Renovate finds the new release
    # Note: The merge request Renovate opened, on the project, by itself. It is not a note saying a release exists: the release is applied inside it, so the diff is the update, ready to read and to merge.
    # Note: Three files, and all three are the framework's: the release the project tracks, the publication floor, and the update machinery itself. That is what makes an update reviewable — a human reads a diff of what actually changes, not a version number and a promise.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    And the merge request it opened carries the release, applied
    # Note: The merge request went in, and the project pulled it. The version line moved to the new release, and under it git says exactly what came with it: the publication floor the framework owns, and nothing besides.
    # Note: That is the whole update for this project, and it is the shape the story is here to guarantee.
    # Copy: grep _commit .config/devsecops/.copier-answers.yml && git diff --stat HEAD~1
    Then the project tracks the new release, and git says exactly what moved
    # Note: The two files that carry the team's own decisions, before and after: git reports no change at all on them, and their contents are what the team wrote.
    # Note: That is copier's three-way merge doing the work. A release edits the files the framework owns and leaves the ones the project owns alone, which for a manifest that decides what becomes public is the whole point.
    # Copy: git diff --stat HEAD~1 -- .config/publication/allowlist .config/publication/owners && cat .config/publication/owners
    And the rules the team wrote came through untouched
    # Note: The same command as four cards ago, and a different answer: src/cluster.kubeconfig is now held back, by the framework floor, because the new release added that rule to it.
    # Note: Nobody edited a list. The project got a tightened safety floor from the release itself, which is exactly why a component that cannot be updated is worse than no component.
    # Copy: task publication:check
    And the tightened floor from that release is already in force
    # Note: The same two listings as the opening card, unchanged. The release also changed a tool this project never installed, and that change did not arrive.
    # Note: An update applies to what you have. It does not quietly grow your project back into the whole framework, which is what makes taking one component a real choice rather than a first step.
    # Copy: ls -A1 && ls .config
    And nothing the project never installed arrived with it
