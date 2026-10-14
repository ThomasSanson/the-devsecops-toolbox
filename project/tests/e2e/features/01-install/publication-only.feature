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
  #
  # The story opens and closes on GitLab: the main branch with its README alone,
  # then the same branch once the install is pushed, its CI/CD variables and its
  # schedule. In between is one live terminal: the project's own files, the
  # checklist caught before its answer, the installer's own words and the
  # component's first run. Every card is paired with a check of the same fact
  # (the screen, the working tree, REST on the main branch), so a regression
  # fails loud even without eyes.
  @publication-only
  Scenario: Ticking source publication on the checklist installs it with its update spine, and nothing else
    # Note: GitLab's page for the main branch of a new project. The Files panel on the left lists one file, README.md, and the table shows it on the commit "Initial commit".
    # Note: The project's random name shows as "project", and dates and avatars are hidden, so the picture is the same on every run.
    # Copy: http://gitlab/<lambda-user>/<project>/-/tree/main
    Given a project on GitLab whose main branch holds only its README
    # Note: The developer's copy of the project already has two files of its own under .config, and neither comes from the toolbox. The terminal shows their permissions: 750 for the tool, which only its owner and group may run, and 600 for the private file, which only its owner may read.
    # Note: Then the tool runs and answers "own tool works". Installing a component must leave both files exactly as they are.
    # Copy: stat -c '%a %n' .config/own-tool.sh .config/private.txt && .config/own-tool.sh
    And the developer's copy already has its own executable tool and an owner-only file under its configuration directory
    # Note: The developer downloads the installer and runs it. It asks whether to install everything, the developer answers "Choose components", and a checklist opens.
    # Note: The developer unticks "Agent mode", moves down and ticks "Source publication". The picture is taken before Enter, because the checklist erases itself once it is answered.
    # Copy: curl -fsSL https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/raw/main/.config/devsecops/install.sh -o /tmp/devsecops-install.sh && bash /tmp/devsecops-install.sh
    When the developer ticks source publication on the checklist
    # Note: The installer's own words after Enter. It says "Source publication installed, with the spine that keeps it up to date." and what to do next: name the people who approve, say what may leave, then run task publication:check.
    # Note: Then it asks where the source goes, for two tokens to get it there, and how strict to be. The tokens are typed blind: neither shows on screen, and neither is written to a file.
    # Note: With them it does the GitLab side. The push token becomes a masked CI/CD variable, a project token is created for Renovate and for the approval, merging now waits until every discussion is resolved, and a nightly schedule is set up. The same questions are task publication:init on any later day.
    # Copy: curl -fsSL https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/raw/main/.config/devsecops/install.sh -o /tmp/devsecops-install.sh && bash /tmp/devsecops-install.sh
    And the developer says where the source goes and hands over the tokens
    # Note: The same line as the second card, with task publication:check added at the end. The permissions are still 750 and 600, and the tool still answers "own tool works".
    # Note: Then the component runs on its own. It names the public repository it was given, says nobody has approved a list yet, and shows what would become public today: README.md, the only file the project tracks so far.
    # Copy: stat -c '%a %n' .config/own-tool.sh .config/private.txt && .config/own-tool.sh && task publication:check
    Then the project's own files are untouched, and the component says what would become public
    # Note: The developer commits everything and pushes it to the main branch. The private file stays on the developer's machine, because git ignores it.
    # Note: GitLab's page for the answers file on the main branch. The Files panel on the left held a single README.md on the first card. It now shows the component under .config/publication, and copier, devsecops, python, renovate and task, the spine that brings the next toolbox release in, beside .env.dist, .gitlab-ci.yml and Taskfile.yml. The project's own-tool.sh is there too, and no linter or container tool came along.
    # Note: The file itself records "_commit: 1.0.0", the toolbox release that rendered it, and "install_scope: publication". That line is what lets task copier:update and Renovate bring the next release in.
    # Copy: http://gitlab/<lambda-user>/<project>/-/blob/main/.config/devsecops/.copier-answers.yml
    When the developer pushes the install to the main branch, GitLab shows the component, its update spine and the release it came from
    # Note: The project's CI/CD variables, in GitLab's settings. TASK_PUBLICATION_TOKEN is the token that was typed, the one that may push to the public repository. TASK_RENOVATE_TOKEN and TASK_PUBLICATION_SOURCE_TOKEN hold the project token the install created, under the two names that use it: Renovate, and the check that reads who approved.
    # Note: All three carry the labels Protected and Masked: GitLab hides their values in job logs and hands them only to protected branches and tags. The developer's own token, the first one typed, is not among them.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/ci_cd
    Then GitLab holds the tokens, masked and protected
    # Note: The project's pipeline schedules. The one the install created runs on the main branch at "0 4 * * * UTC", every night at four. It has not run yet: its last pipeline is "None".
    # Note: Each night it asks whether a new toolbox release exists, and Renovate opens the merge request when one does. A quiet repository still gets the latest rules on what may become public.
    # Copy: http://gitlab/<lambda-user>/<project>/-/pipeline_schedules
    And a nightly check will bring the next toolbox release in

  @publication-existing-framework
  Scenario: A complete project cannot be replaced by a component install
    # Note: GitLab's page for the answers file on the main branch of a project that already uses the complete framework. Copier wrote it, the developer pushed it, and it records the project's own choices: "container_runtime: podman", "project_enabled: true", "source_publication: false" and "install_scope: everything".
    # Note: The developer's copy also holds a tool and a private file of its own. Before the installer runs, the test records every file of the project, its content and its permissions.
    # Copy: http://gitlab/<lambda-user>/<project>/-/blob/main/.config/devsecops/.copier-answers.yml
    Given a project whose main branch already carries the complete framework and its own Copier choices
    # Note: The same installer and the same checklist as when source publication is installed on its own. The developer ticks "Source publication" alone.
    # Copy: curl -fsSL https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/raw/main/.config/devsecops/install.sh -o /tmp/devsecops-install.sh && bash /tmp/devsecops-install.sh
    When the developer ticks source publication on the checklist
    # Note: The installer stops before copying anything. It says the answers file "already describes a complete framework installation", and gives the command that turns publication on through the project's own update: task copier:update with --data source_publication=true.
    # Note: Then the developer types git status. Git answers "nothing to commit, working tree clean": the project is still exactly what the main branch on GitLab holds. The test also compares every file, its content and its permissions with what it recorded first.
    # Copy: task copier:update TASK_COPIER_CLI_OPTS="--data source_publication=true"
    Then the installer refuses, names the update path, and leaves the project exactly as the main branch holds it
