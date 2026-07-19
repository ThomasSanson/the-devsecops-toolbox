@e2e @toolbox-update-conflict
Feature: A toolbox release collides with a file I hand-edited — the update shows the conflict
  As a maintainer of a project generated from the DevSecOps Toolbox
  I want `task copier:update` to tell me when a new release changes a framework
  file I had edited myself, instead of silently dropping either change
  So that I can resolve the clash on purpose and keep my own intent.

  # A separate story from @toolbox-update on purpose: that one proves the update
  # PRESERVES my work (skip-if-exists files and clean additions); this one proves
  # what happens when my edit and the release COLLIDE on the same framework file.
  # Keeping it apart keeps both storyboards short and each focused on one arc.
  #
  # ONE Gherkin sentence = ONE card = ONE pixel baseline, asserted inside the
  # step (tolerance: 0); every card twins its frame with a filesystem/git check
  # of the same fact, so a regression fails loud even without eyes. Pure
  # filesystem + git + copier inside the runner — no GitLab involved. The
  # conflicted file is .gitlab-ci.yml, which the toolbox owns and overwrites on
  # update (it is not a keep-my-file), pinned to the toolbox base image.
  Scenario: a toolbox update collides with my edit on a framework file, and I resolve it
    # Chapter: My edit and the release collide on the same line
    # Note: A project made from an older toolbox release (1.0.0). Its CI pipeline runs inside a toolbox image, pinned to that release — the line on screen is the image every pipeline run uses. This .gitlab-ci.yml is framework-owned, so an update is allowed to change it.
    # Copy: grep '^image:' .gitlab-ci.yml
    Given a project generated from an earlier toolbox release pins its CI image to that release
    # Note: The team pins their own hardened image tag on that same line and commits it. Because .gitlab-ci.yml is framework-owned, the next toolbox update will try to change this very line too.
    # Copy: sed -i 's/:1.0.0$/:1.0.0-hardened/' .gitlab-ci.yml && git commit -am "ci: pin our hardened image"
    When the developer hand-edits that framework file and commits the change
    # Note: The exact command Renovate runs on its own for a new release. This release (1.0.1) moves the image to the new toolbox version — the same line the developer just changed.
    # Copy: task copier:update TASK_COPIER_CLI_OPTS='--vcs-ref 1.0.1'
    When a newer release moves the same line and the developer runs the toolbox update
    # Note: The update can't merge two different edits to the same line. It keeps the new release's line in .gitlab-ci.yml and saves the developer's change in a .gitlab-ci.yml.rej file — a patch to reapply by hand. Nothing is silently dropped.
    # Copy: cat .gitlab-ci.yml.rej
    Then the update keeps the new line and saves my change in a reject file
    # Chapter: I resolve the conflict and keep my intent
    # Note: The developer keeps their hardening intent, now on top of the new release: the image becomes :1.0.1-hardened. The conflict marks are removed and the fix is staged.
    # Copy: grep '^image:' .gitlab-ci.yml
    When the developer resolves the conflict and keeps their pin on the new release
    # Note: After committing the resolution the working tree is clean, the update is complete, and the image line carries the developer's hardening applied to the new toolbox release.
    # Copy: git status --short && grep '^image:' .gitlab-ci.yml
    Then the tree is clean again and the developer's own intent is preserved
