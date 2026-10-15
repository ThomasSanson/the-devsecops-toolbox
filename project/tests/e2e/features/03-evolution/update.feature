@e2e
Feature: A toolbox release arrives as a merge request and keeps my work
  As a maintainer of a project generated from the DevSecOps Toolbox
  I want to ask for the new release myself and review it before it lands
  So that upgrading the framework never destroys my own changes, and never
  reaches the main branch without a review

  # cspell:ignore Caddyfile -- the developer's own word in this story
  # ONE story on ONE GitLab project. A project generated from release 22.0.0 of
  # a two-release fixture sits on GitLab with the developer's own commit on top:
  # a task of their own, and the word it brings to the spell checker, added to
  # the one dictionary file that release has. The developer runs
  # `task devsecops:update` and release 22.7.1 arrives as a merge request: the
  # dictionary splits in three, the word moves to a file the project owns, the
  # CI image moves forward. A changed answer (Ansible on) is then pushed to the
  # same merge request, and the developer's task file is never touched, although
  # release 22.7.1 rewords a line of it in the template. Renovate's own trigger
  # of the same update is proven by @renovate-flow.
  #
  # ONE sentence = ONE card = ONE pixel baseline (tolerance 0). Six cards are
  # real GitLab pages, 1440 px wide; two are the developer's terminal, from the
  # typed line down. Every card is twinned with REST on the branches, the
  # commits and the merge request, or with the terminal's own words, so a
  # regression fails loud even without eyes.
  @toolbox-update
  Scenario: a toolbox update arrives as a merge request, splits the dictionary and keeps my work
    # Chapter: Before the release, my project on GitLab carries my own changes
    # Note: GitLab's branches page for the project. It lists one branch, the main branch, and its last commit is the developer's own, "feat: add a task that reloads Caddy".
    # Note: Off camera, the project was generated from toolbox release 22.0.0 and pushed with that commit on top. CI is switched off for it, so no pipeline runs in this story. Its random name shows as "project", and dates and avatars are hidden.
    # Copy: http://gitlab/<lambda-user>/<project>/-/branches
    Given a developer's toolbox project sits on GitLab with only its main branch
    # Note: The page of that commit. In project/Taskfile.yml the developer adds a task of their own, project:operate:caddy:reload.
    # Note: Its description says "Caddyfile", a word the spell checker does not know. So the commit also adds "Caddyfile" to .config/cspell/config.json, the one dictionary file of release 22.0.0, after the framework's own words.
    # Copy: http://gitlab/<lambda-user>/<project>/-/commit/<sha>
    And the developer has pushed their own spelling word and their own task to the main branch
    # Chapter: I ask for the release, and it arrives as a merge request
    # Note: The developer's terminal, on the main branch. One command asks for the latest toolbox release. Copier says "Updating to template version 22.7.1" and runs the release's migration, which prints "[cspell migration] moving the project words out of the shared file".
    # Note: The task then commits the change on a new branch, update-framework-devsecops, pushes it, and opens merge request !1, "chore(deps): update devsecops toolbox to 22.7.1".
    # Copy: task devsecops:update
    When the developer asks for the new toolbox release from the main branch
    # Note: The Changes tab of that merge request, the page a reviewer reads. The file list on the left shows the dictionary split in three: config.base.json and config.project.json are new, and config.json is changed.
    # Note: The reviewer folds the three long diffs and clicks config.project.json, which GitLab frames in blue. That new file holds "Caddyfile", and the next update will never overwrite it. Below, the answers file moves from 22.0.0 to 22.7.1, and so does the toolbox image of the CI pipeline in .gitlab-ci.yml.
    # Note: The line counters are hidden: the framework's word list grows every few days.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1/diffs
    Then GitLab holds a merge request that moves the project to the new release and gives the developer's word a file of its own
    # Chapter: A changed answer adds tools, and my own task stays mine
    # Note: The same terminal, still on the update branch. The developer runs the update again with one answer changed, ansible_enabled=true, and Copier says "Copier update completed successfully.".
    # Note: The same line then commits the new files as "chore: turn the Ansible option on" and pushes them to the update branch, the branch of the same merge request.
    # Copy: task copier:update TASK_COPIER_CLI_OPTS='--defaults --data ansible_enabled=true' && git add -A && git commit -q -m 'chore: turn the Ansible option on' && git push -q
    When the developer turns the Ansible option on and pushes the re-run update to the same merge request
    # Note: The same Changes tab after that push, every diff open. The tab now reads "Commits 2", and the file list opens with the Ansible tooling: .config/ansible (Taskfile.yml, ansible.cfg, requirements.txt) and .config/ansible-lint. The root Taskfile.yml is changed too, to load the Ansible tasks.
    # Note: Nothing under project/ is in the list: the developer's own files are not part of the update.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1/diffs
    Then the same merge request now also brings the Ansible tooling
    # Note: GitLab's history of project/Taskfile.yml on the update branch, the page its History button opens. It lists two commits, the one that generated the project and the developer's own. Neither update commit is there.
    # Note: Release 22.7.1 does reword a line of this file in the template. The file is listed as "skip if exists", so once a project has it, an update leaves it alone.
    # Copy: http://gitlab/<lambda-user>/<project>/-/commits/update-framework-devsecops/project/Taskfile.yml
    And GitLab's history of the developer's task file shows neither update ever touched it
    # Note: The branches page again, as on the first card. update-framework-devsecops now stands next to the main branch, two commits ahead of it, with its merge request !1.
    # Note: The main branch still ends on the developer's own commit. Nobody pushed to it: the release reaches the main branch only once the merge request is reviewed and merged.
    # Copy: http://gitlab/<lambda-user>/<project>/-/branches
    And the update branch stands next to a main branch nobody pushed to
