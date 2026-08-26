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
  # answers file. 22 files against 199 for a full install, and not one tool: no
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
    # Note: The installer's last questions: where the source goes, the two tokens to get it there, and how strict to be. Both tokens are typed blind, neither is echoed, and neither is written to a file.
    # Note: What it does with them is the whole GitLab side. It stores the push token as a masked variable, creates a project token so that Renovate and the approval never need a person's own, and schedules the nightly check that brings the next toolbox release in. The last answer decides what happens when the secret scan cannot run at all: enter keeps the strict one, no publication. The same four questions are task publication:init on any later day.
    # Copy: bash /tmp/devsecops-install.sh
    And the developer says where the source goes and hands over the tokens
    # Note: Beside the README it started with, the install added four things: .config, .env.dist, .gitlab-ci.yml and Taskfile.yml. Taskfile.yml runs the publication, .env.dist holds its settings, and .gitlab-ci.yml was written because there was none — a project that already has a pipeline keeps it, and is told the one line to add. Under .config, publication is the component itself, and copier, devsecops, python, renovate and task are the spine that will bring the next toolbox release in and run it.
    # Note: No megalinter, no docker, no glab: not one tool came along, and nothing that a project taking a single component has no use for.
    # Copy: ls -A1 && ls .config
    Then the project holds the publication component and the spine that carries it
    # Note: The project's CI/CD variables, as GitLab holds them. The one that was typed is there, the token that may push to the public repository; the other two are the project token the install created, under the two names that use it — Renovate, and the sign-off that reads who approved.
    # Note: All three are masked and protected, so none can be printed by a job or read back by anyone, including the developer who just typed one. Nobody's personal token ever reaches CI.
    # Copy: Settings > CI/CD > Variables
    And GitLab holds the tokens, masked and protected
    # Note: And the schedule that runs it. Every night at four, this project asks whether a new toolbox release exists, and Renovate opens the merge request when one does.
    # Note: A repository can be quiet for a month; the rules deciding what becomes public still cannot be allowed to go stale for a month.
    # Copy: Build > Pipeline schedules
    And a nightly check will bring the next toolbox release in
    # Note: It runs, with nothing else installed. The lists that just landed answer the only question that matters, what would become public, and right now that is the README, because the shipped allowlist publishes everything tracked and the README is all there is.
    # Note: The destination it was just given is on the first line, and under it the only thing still missing: nobody has approved a list yet, so nothing has ever been published from here.
    # Copy: task publication:check
    And it runs, and says what would become public
    # Note: And it knows where it came from. One line in the answers file records the toolbox release that rendered it.
    # Note: That line is what makes the component maintainable rather than a dead copy: a later release comes in with task copier:update, and Renovate opens the merge request that offers it.
    # Copy: grep _commit .config/devsecops/.copier-answers.yml
    And it records the toolbox release it came from
