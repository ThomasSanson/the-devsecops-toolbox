@e2e
Feature: A toolbox release reaches a project that installed only source publication
  As a team that took one component instead of the whole framework
  I want a new toolbox release to update that component and the little that
  carries it, and nothing else
  So that the rules deciding what becomes public never go stale, and never
  come back to a project that did not ask for them

  # A component installed on its own would be a dead copy: no version, no way to
  # learn a new release exists, no way to apply it. So the install keeps the
  # framework's OWN update machinery rather than inventing a second one: the
  # copier answers file that records the template and the version, the handful
  # of files `task copier:update` needs to run, the Renovate config that watches
  # that answers file, and the component.
  #
  # This story runs a real toolbox release against a real GitLab. The new
  # version tightens the publication floor, touches the update machinery itself,
  # and changes a tool the project never installed. Nobody types the update: the
  # feedback phase runs Renovate, Renovate opens the merge request and applies
  # the release inside it, and the merge request goes into the main branch. The
  # story then reads the main branch on GitLab, on the same page as before the
  # update, and runs the same check in the same terminal.
  @publication-update
  Scenario: the release updates the component and its spine, spares the team's rules, and brings nothing else
    # Note: GitLab's page for the folder .config/publication on the main branch. The Files panel on the left shows the whole project: .config holds only copier, devsecops, publication, python, renovate and task. There is no linter, no container tooling and no forge tooling.
    # Note: The table lists the nine publication files. All of them, the team's own allowlist and owners included, sit on the team's commit "chore: install source publication and our own rules". Remember this page: the story comes back to it after the update.
    # Copy: http://gitlab/<lambda-user>/<project>/-/tree/main/.config/publication
    Given a project on GitLab that installed source publication and nothing else
    # Note: The terminal, in the team's clone of that project. task publication:check lists what a release would publish today: "Publishing 3 files", and the third one is src/cluster.kubeconfig, a cluster credential that nobody thought to deny.
    # Note: Remember this answer. The last card runs the same check again, and nobody touches a single rule in between.
    # Copy: task publication:check
    And what it would publish today, cluster credential included
    # Note: The story runs task feedback, the phase GitLab's nightly schedule runs. Renovate reads the release recorded in the answers file, finds 1.0.1 on the template and opens this merge request by itself: "fix(devsecops): update devsecops toolbox to v1.0.1", from a renovate branch into the main branch. Its badge says Merged.
    # Note: Renovate applied the release inside the merge request, so its Changes tab is the update itself. Three files, all three the framework's own: the update machinery in .config/copier/Taskfile.yml, the recorded release going from 1.0.0 to 1.0.1, and the publication floor in denylist.base, which gains the line *.kubeconfig.
    # Copy: task feedback
    When the feedback task runs, Renovate opens a merge request that applies the new release, and that merge request goes into the main branch
    # Note: The same page as the first card, after the merge. One row moved: denylist.base now sits on Renovate's commit "fix(devsecops): update devsecops toolbox to v1.0.1", the commit named in the box above the table.
    # Note: allowlist and owners, the rules the team wrote, still sit on the team's commit. Copier's three-way merge changed the framework's files and left the team's files alone. The Files panel still shows the same six folders in .config: the release also changed a tool this project never installed, and that change did not arrive.
    Then on the main branch the team's rules keep their own commit, and nothing the project never installed arrives
    # Note: Back in the same terminal, one line pulls the main branch and runs the same check as the second card. src/cluster.kubeconfig has moved under "Withholding 1 file", held back by the "framework floor", because the release added *.kubeconfig to that floor.
    # Note: Nobody edited a list. The project got a tighter safety floor from the release itself, which is why a component that cannot be updated is worse than no component.
    # Copy: git pull -q origin main && task publication:check
    And after a pull, the tightened floor from that release is already in force
