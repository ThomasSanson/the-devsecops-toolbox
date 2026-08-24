@e2e
Feature: Installing only the source publication component
  As a developer whose project must publish its source but does not want the
  rest of the framework
  I want the installer's checklist to let me take source publication on its own
  So that the project gains the files that decide what becomes public, plus the
  little that keeps them up to date, and nothing else

  # The checklist the installer opens is not a single choice: it lists the parts
  # that stand on their own, and any of them can be taken alone. The AI agent
  # files are one; source publication is the other, and it is the one a project
  # reaches for when its source has to be public while its repository stays
  # private.
  #
  # What lands is the component AND the spine that keeps it up to date: the
  # copier answers file that records the template and the release, the handful of
  # files `task copier:update` needs, and the Renovate config that watches that
  # answers file. 16 files against 199 for a full install, and not one tool: no
  # linter, no container runtime, no forge CLI. A component nobody can update
  # would be worse than no component, which is why the spine travels with it.
  @publication-only
  Scenario: Ticking source publication on the checklist installs it with its update spine, and nothing else
    # Note: A terminal on a freshly cloned project. There is a README and nothing else, and git reports no changes: no framework, no task runner, no configuration of any kind.
    # Copy: ls -A1 && git status --short
    Given a project that carries no framework at all
    # Note: The installer asks whether to install everything. Saying no opens the checklist, and this time the cursor moves down to the second line and ticks source publication instead of the AI agent files.
    # Note: Two lines, two parts that stand on their own. The tick is what decides; pressing enter takes exactly what is ticked.
    # Copy: bash /tmp/devsecops-install.sh
    When the developer ticks source publication on the checklist
    # Note: The installer says what it installed and what to do next: name the people who approve, say what may leave, then run the check.
    # Note: Beside the README it started with, the install added three things: .config, .env.dist and Taskfile.yml. Taskfile.yml runs the publication and .env.dist holds its settings; under .config, publication is the component itself, and copier, devsecops, python and renovate are the spine that will bring the next toolbox release in.
    # Note: No megalinter, no docker, no glab: not one tool came along, and nothing that a project taking a single component has no use for.
    # Copy: ls -A1 && ls .config
    Then the project holds the publication component and the spine that carries it
    # Note: It runs. The lists that were just installed answer the only question that matters, what would become public, and right now that is the README, because the shipped allowlist publishes everything tracked and the README is all there is.
    # Note: The last line is what makes this maintainable: the project records which toolbox release it came from, so a later release can be brought in with task copier:update, and Renovate can open the merge request that offers it.
    # Copy: task publication:check && grep _commit .config/devsecops/.copier-answers.yml
    And it runs, and it records the release it came from
