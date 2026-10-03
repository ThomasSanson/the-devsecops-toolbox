@e2e
Feature: A release that fails leaves nothing broken behind
  As a maintainer of the project
  I want a failed release to leave neither the main branch open nor a tag without its image
  So that a crashed release can always be relaunched on a clean project

  # The main branch is protected: every change must go through a reviewed merge
  # request, so nobody pushes code straight to it. The release job is the single
  # exception. To publish a new version it briefly grants itself push access to
  # the main branch, writes one small version-bump commit, then removes that
  # access again. This test kills a real release mid-push, while it still holds
  # that push access, and proves the main branch ends up locked anyway.
  #
  # A release publishes two things that must stay in step: the container image
  # every later pipeline runs on, and the tag plus version commit on the main
  # branch that names it. The second chapter breaks the publish step of a real
  # release and proves nothing was pushed for an image that does not exist.
  #
  # ONE sentence = ONE card = ONE pixel baseline (tolerance: 0); every card is a
  # real GitLab page, twinned with a REST/log check of the same fact.
  @release-window
  Scenario: a crashed release leaves the main branch locked and pushes no tag without its image
    # Chapter: The push window always closes
    # Note: Normally nobody may push code straight to the main branch; every change goes through a reviewed merge request. The release job is the one exception: to publish a new version it briefly grants itself push access to the main branch, then locks it again. On GitLab this real release pipeline ran on the main branch and crashed: the pipeline reads Failed and the release job shows a red cross. It died mid-push with that push access still open, so right now the main branch could be sitting open to an unreviewed push.
    # Copy: http://gitlab/<lambda-user>/<project>/-/pipelines/<id>
    Given a release job crashes on the main branch while it still holds push access
    # Note: If nothing steps in now, the main branch stays open and anyone could push unreviewed code to it. But GitLab always runs a job's after_script, a cleanup step that runs on every outcome, pass or fail. Here that after_script runs the lock task, task glab:release:lock-default-branch; the log reads "Default branch protection restored (push=No one)", and the release job still ends on a red Failed pill. That cleanup step is what re-locks the main branch no matter how the release dies.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<id>
    When GitLab's after_script re-locks the main branch even though the release job failed
    # Note: The release crashed while it still held push access to the main branch, the exact moment the main branch could have been left open to anyone. Yet GitLab's protected-branch settings for the main branch show "Allowed to push: No one". The main branch is locked again; every change must go back through a reviewed merge request. The safety net held: a crashed release cannot leave the main branch open to unreviewed pushes.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/repository
    Then the main branch is locked again even though the release crashed
    # Chapter: A release that cannot publish its image pushes nothing
    # Note: A release publishes two things: the container image every later pipeline runs on, and the tag plus version commit on the main branch that names it. This second release cuts its version, "build: bump version 0.1.0 → 0.2.0", then its publish step fails on "ERROR: the image could not be published". Read the log to the end: it stops right there, and no line says the tag was pushed. The release gave up before touching the main branch.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<id>
    When the image of a second release cannot be published, so the release job stops before its push
    # Note: The tags page of the project is empty: "Repository has no tags yet". Nothing was pushed, so no tag names an image that was never published, and the main branch is still on its first commit with no version bump. Relaunching this release starts from a clean project instead of stopping on a tag that already exists.
    # Copy: http://gitlab/<lambda-user>/<project>/-/tags
    Then the project has no tag at all, so the main branch never points at a missing image
