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
    # Note: The project already has its own configuration directory. Its tool is executable with mode 0750, and its private data file has mode 0600. Neither file comes from the toolbox, and the project has no Copier answers yet.
    # Note: The terminal reads their real permissions and SHA-256 hashes, then executes the tool. Installing a component must preserve all three properties.
    # Copy: stat -c '%a %n' .config/existing-tool.sh .config/private-data.txt && sha256sum .config/existing-tool.sh .config/private-data.txt && ./.config/existing-tool.sh
    And the project already has an executable tool and an owner-only file under its configuration directory
    # Note: The installer asks whether to install everything. Saying no opens the checklist, and this time the cursor moves down to the second line and ticks source publication instead of the AI agent files.
    # Note: Two lines, two parts that stand on their own. The tick is what decides; pressing enter takes exactly what is ticked.
    # Copy: bash /tmp/devsecops-install.sh
    When the developer ticks source publication on the checklist
    # Note: The installer says what it installed and what to do next: name the people who approve, say what may leave, then run the check.
    # Note: The installer's last questions: where the source goes, the two tokens to get it there, and how strict to be. Both tokens are typed blind, neither is echoed, and neither is written to a file.
    # Note: What it does with them is the whole GitLab side. It stores the push token as a masked variable, creates a project token so that Renovate and the approval never need a person's own, and schedules the nightly check that brings the next toolbox release in. The last answer decides what happens when the secret scan cannot run at all: enter keeps the strict one, no publication. The same four questions are task publication:init on any later day.
    # Copy: bash /tmp/devsecops-install.sh
    And the developer says where the source goes and hands over the tokens
    # Note: Beside the README and configuration files it started with, the install added .env.dist, .gitlab-ci.yml and Taskfile.yml, and its own files under .config. Taskfile.yml runs the publication, .env.dist holds its settings, and .gitlab-ci.yml was written because there was none — a project that already has a pipeline keeps it, and is told the one line to add. Under .config, publication is the component itself, and copier, devsecops, python, renovate and task are the spine that will bring the next toolbox release in and run it.
    # Note: No megalinter, no docker, no glab: not one tool came along, and nothing that a project taking a single component has no use for.
    # Copy: ls -A1 && ls .config
    Then the project holds the publication component and the spine that carries it
    # Note: The same files are inspected after installation. Their hashes must match the preparation card, their modes must remain 0750 and 0600, and the tool must still execute successfully.
    # Copy: stat -c '%a %n' .config/existing-tool.sh .config/private-data.txt && sha256sum .config/existing-tool.sh .config/private-data.txt && ./.config/existing-tool.sh
    And the existing tool still runs and both existing files keep their contents and permissions
    # Note: The project's CI/CD variables, as GitLab holds them. The one that was typed is there, the token that may push to the public repository; the other two are the project token the install created, under the two names that use it — Renovate, and the sign-off that reads who approved.
    # Note: All three are masked and protected: GitLab redacts their literal values in job logs and restricts their availability to protected refs. Jobs that receive a token can still use or expose it, and authorized API clients can retrieve it. The personal setup token is not stored in CI.
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

  @publication-existing-framework
  Scenario: A complete project cannot be replaced by a component install
    # Chapter: The project already has a framework and its own choices
    # Note: A fresh clone provides the same real installer terminal as the component journey. The next step generates the complete framework with the working template before attempting installation.
    Given a project that carries no framework at all
    # Note: This is a real Copier render with the complete install scope, Podman, an enabled project workspace, and source publication disabled. The answers are generated by Copier, not written by the test.
    # Note: The executable tool and private file are also present. The test records the entire project's file hashes, inventory and permissions, excluding Git's internal directory.
    # Copy: grep -E '^(install_scope|source_publication|container_runtime|project_enabled):' .config/devsecops/.copier-answers.yml
    And that project was generated with the complete framework and its own Copier choices
    # Chapter: Choose the component and receive a safe refusal
    # Note: The developer chooses source publication in the real installer checklist. That choice must not replace the answers or copy any part of the component into an existing complete project.
    # Copy: bash /tmp/devsecops-install.sh
    When the developer ticks source publication on the checklist
    # Note: The installer must return a failure before copying files. Its own session log records the exit status and explains how to enable publication through the existing project's update mechanism.
    # Copy: task copier:update TASK_COPIER_CLI_OPTS="--data source_publication=true"
    Then the installer refuses the component install and explains how to update the existing project
    # Note: The real answer values, file hashes, permissions and tool execution are inspected again. The assertions compare every original file and directory with the initial state, and reject extra files as well as overwritten files.
    # Copy: grep -E '^(install_scope|source_publication|container_runtime|project_enabled):' .config/devsecops/.copier-answers.yml
    And the complete project keeps every original file and permission without gaining a component copy
