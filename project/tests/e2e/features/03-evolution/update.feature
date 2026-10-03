@e2e
Feature: A toolbox release arrives — copier update preserves my work
  As a maintainer of a project generated from the DevSecOps Toolbox
  I want the new release to apply while keeping every edit I made, whether
  Renovate brings it in automatically or I ask for it myself
  So that upgrading the framework never destroys my customizations, and never
  lands on main without a review

  # cspell:ignore Caddyfile -- the update story's project word, carried in the card notes below
  # ONE story in three chapters. ONE Gherkin sentence = ONE card = ONE pixel
  # baseline, asserted inside the step (tolerance: 0); every AFTER card twins
  # its frame with a filesystem check read straight from the project, so a
  # regression fails loud even without eyes.
  #
  # Chapter 1 runs in a REAL coloured terminal: a project generated from an
  # OLDER toolbox version, with its own spelling word crammed into the single
  # framework dictionary, receives the exact update Renovate triggers. The
  # dictionary splits into three files, the framework words stay in the
  # framework file, and the developer's own word moves to its own project file.
  # Chapter 2 shows the same promise from the render side: re-running the update
  # with a flipped answer (Ansible turned on) delivers the brand-new tooling the
  # release ships, while a file the developer hand-edited is left exactly as
  # they wrote it.
  # Chapter 3 is the same upgrade asked for BY HAND, on a REAL GitLab project:
  # `task devsecops:update` from the main branch applies the release and opens
  # the merge request itself, so the update reaches main through a review
  # instead of a direct push — what Renovate does for a project that has it,
  # available to every project that does not.
  @toolbox-update
  Scenario: a toolbox update splits the dictionary, keeps my work, and reaches main through a review
    # Chapter: The update splits the dictionary and keeps my word
    # Note: A project made with an older toolbox (release 22.0.0), from before the spelling dictionary was split. The line on screen shows which toolbox version it came from.
    # Copy: grep _commit .config/devsecops/.copier-answers.yml
    Given a developer's project was generated from an earlier toolbox release
    # Note: The project's CI pipeline runs inside a toolbox image, pinned to that same old release. The line on screen is the image every pipeline run uses.
    # Copy: grep '^image:' .gitlab-ci.yml
    And its CI pipeline runs on that older toolbox image
    # Note: At this old release the whole spelling dictionary is one file, config.json — the only place a project can add its own words.
    # Copy: ls -1 .config/cspell/
    And its spelling dictionary is a single framework-owned file
    # Note: The developer's own word (Caddyfile) sits inside config.json, mixed in with the framework's own words.
    # Copy: jq '.words[-4:]' .config/cspell/config.json
    And the developer has added their own word inside that shared file
    # Note: The exact command Renovate runs on its own to move to release 22.7.1. It refreshes the dictionary and moves the developer's word to its own file.
    # Copy: task copier:update TASK_COPIER_CLI_OPTS='--skip-answered --defaults --quiet --vcs-ref 22.7.1'
    When the developer runs the toolbox update in the terminal
    # Note: The project is now on release 22.7.1 — the version line has moved forward.
    # Copy: grep _commit .config/devsecops/.copier-answers.yml
    Then the project now tracks the new toolbox release
    # Note: After the update the pipeline image points to the new release — every pipeline run now uses the new toolbox.
    # Copy: grep '^image:' .gitlab-ci.yml
    And its CI pipeline now runs on the new toolbox image
    # Note: The one dictionary is now three files: config.json, config.base.json (framework words) and config.project.json (project words).
    # Copy: ls -1 .config/cspell/
    And its dictionary has been split into three files
    # Note: The framework's own words now live in config.base.json — the developer's word is not among them.
    # Copy: jq '.words[-4:]' .config/cspell/config.base.json
    And the framework keeps its own words in its own file
    # Note: The developer's word (Caddyfile) has moved to config.project.json, the file a toolbox update never overwrites.
    # Copy: jq . .config/cspell/config.project.json
    And the developer's own word has moved to a project-owned file
    # Note: config.json now holds no words of its own; it only pulls in the other two files.
    # Copy: jq '.words' .config/cspell/config.json
    And the shared file itself is now empty — it only imports the other two
    # Chapter: A flipped answer delivers new tools and spares my edits
    # Note: Off-camera: a versioned template (releases 1.0.0 → 1.0.1), a project generated at 1.0.0, then the developer appends their own marker to project/Taskfile.yml — a copier skip-if-exists file an update must never overwrite.
    # Copy: tail -4 project/Taskfile.yml
    Given a project generated from an earlier toolbox release carries the developer's own edit
    # Note: With the default answers the generated project has no Ansible tooling: grepping .config for ansible finds nothing.
    # Copy: ls -1A .config | grep ansible
    And the project has no Ansible configuration yet
    # Note: The same `copier update`, this time answering ansible_enabled=true: the same grep now finds the ansible and ansible-lint entries the flip delivered.
    # Copy: task copier:update TASK_COPIER_CLI_OPTS='--data ansible_enabled=true'
    When the developer re-runs the toolbox update and turns the Ansible option on
    # Note: The flipped answer delivers the release's Ansible tooling — .config/ansible and .config/ansible-lint.
    # Copy: ls -1A .config/ansible .config/ansible-lint
    Then the new Ansible tooling is delivered by the update
    # Note: project/Taskfile.yml still carries the developer's marker after the update — the skip-if-exists file was never overwritten.
    # Copy: tail -4 project/Taskfile.yml
    And the developer's own edit survived the update untouched
    # Chapter: I ask for the release myself, and it arrives as a merge request
    # Note: Off camera: a project generated from an older toolbox release (1.0.0) and pushed to GitLab. On screen, the branch the developer is standing on and the release the project came from.
    # Copy: git branch --show-current && grep _commit .config/devsecops/.copier-answers.yml
    Given a project generated from an earlier toolbox release sits on its main branch
    # Note: The project's branches page on GitLab before anything happens: main, on its own.
    # Copy: http://gitlab/<lambda-user>/<project>/-/branches
    And GitLab holds that main branch on its own
    # Note: The developer asks for the new release instead of waiting for Renovate. One command applies release 1.0.1 and opens the review.
    # Copy: task devsecops:update
    When the developer asks for the new toolbox release from the main branch
    # Note: The merge request that command opened: it carries the new release number in its title and aims at the main branch.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    Then GitLab now holds a merge request carrying the new release
    # Note: The branches page now: the update branch stands next to main, and main itself never took a direct push.
    # Copy: http://gitlab/<lambda-user>/<project>/-/branches
    And the update branch stands next to a main nobody pushed to
