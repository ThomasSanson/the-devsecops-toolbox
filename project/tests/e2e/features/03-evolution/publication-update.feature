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
  # 16 files against 199 for a full install: the copier answers file that records
  # the template and the version, the handful of files `task copier:update` needs
  # to run, the Renovate config that watches that answers file, and the component.
  #
  # This story simulates a real toolbox release. The new version tightens the
  # publication floor, touches the update machinery itself, and changes a tool
  # the project never installed. Then it runs the exact command Renovate triggers, and reads
  # back what moved: the version, the framework's files, and nothing else. The
  # rules the team wrote themselves are still theirs.
  @publication-update
  Scenario: the release updates the component and its spine, spares the team's rules, and brings nothing else
    # Note: A project that ticked source publication on the installer's checklist and nothing else. Its own README and src are there; the install added three things beside them, .config, .env.dist and Taskfile.yml, and five entries under .config. Sixteen files in all, and the last line is the release they came from.
    # Note: What is NOT there is the point: no linter, no container runtime, no forge tooling, and not even the phase orchestrators a full project gets. Only what runs the publication and what keeps it up to date.
    # Copy: ls -A1 && ls .config && grep _commit .config/devsecops/.copier-answers.yml
    Given a project that installed source publication and nothing else
    # Note: What the project would publish today. Three files, and among them src/cluster.kubeconfig, a cluster credential that nobody thought to deny.
    # Note: Remember this list. The same command answers differently four cards from here, without anyone touching a single rule.
    # Copy: task publication:check
    And what it would publish today, cluster credential included
    # Note: A new toolbox release lands. This is the exact command Renovate runs in a real repository when it opens the framework-evolution merge request; nothing here is a stand-in for it.
    # Copy: task copier:update TASK_COPIER_CLI_OPTS='--skip-answered --defaults --vcs-ref 1.0.1'
    When a new toolbox release arrives and the update runs
    # Note: The version line moved to the new release, and under it git says exactly what came with it: the machinery that performed the update, and the publication floor the framework owns.
    # Note: Three files. That is the whole update for this project, and it is the shape the story is here to guarantee.
    # Copy: grep _commit .config/devsecops/.copier-answers.yml && git diff --stat
    Then the project tracks the new release, and git says exactly what moved
    # Note: The two files that carry the team's own decisions, before and after: git reports no change at all on them, and their contents are what the team wrote.
    # Note: That is copier's three-way merge doing the work. A release edits the files the framework owns and leaves the ones the project owns alone, which for a manifest that decides what becomes public is the whole point.
    # Copy: git diff --stat -- .config/publication/allowlist .config/publication/owners && cat .config/publication/owners
    And the rules the team wrote came through untouched
    # Note: The same command as four cards ago, and a different answer: src/cluster.kubeconfig is now held back, by the framework floor, because the new release added that rule to it.
    # Note: Nobody edited a list. The project got a tightened safety floor from the release itself, which is exactly why a component that cannot be updated is worse than no component.
    # Copy: task publication:check
    And the tightened floor from that release is already in force
    # Note: The same two listings as the opening card, unchanged. The release also changed a tool this project never installed, and that change did not arrive.
    # Note: An update applies to what you have. It does not quietly grow your project back into the whole framework, which is what makes taking one component a real choice rather than a first step.
    # Copy: ls -A1 && ls .config
    And nothing the project never installed arrived with it
