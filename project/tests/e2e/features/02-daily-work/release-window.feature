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
    # Note: Nobody may push straight to the main branch: every change goes through a reviewed merge request. The release job is the one exception, and this is its real log on GitLab, from the moment its new version is ready.
    # Note: The release job opens that exception, "Temporarily opening push access for Maintainers", and dies on "Could not resolve host" right after "Pushing tags and the version commit to main...". On its way out the release job takes the push access back itself, "Default branch protection restored (push=No one).", and GitLab's after_script, a cleanup step that runs on every outcome, runs task glab:release:lock-default-branch and takes it back a second time. The job still ends on a red Failed pill.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<id>
    Given a release job on the main branch crashes mid-push while it still holds push access, then locks the main branch again on its way out
    # Note: GitLab's own settings for the main branch, opened after the crash. In the "Protected branches" table the main branch reads "Allowed to merge: Maintainers" and "Allowed to push and merge: No one".
    # Note: The crash left no push access behind: every change to the main branch goes through a reviewed merge request again.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/repository
    Then the main branch is locked again even though the release crashed
    # Chapter: A release that cannot publish its image pushes nothing
    # Note: A release publishes two things that must stay in step: the container image every later pipeline runs on, and the tag plus version commit on the main branch that names it. The same release job page as the first card, for a second release.
    # Note: This second release starts the same way, "Release version cut locally", then "Publishing the image for version 0.2.0...", and stops on "ERROR: the image could not be published". No "Pushing tags" line follows: the release gave up before touching the main branch.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<id>
    When the image of a second release cannot be published, so the release job stops before its push
    # Note: The tags page of the project reads "Repository has no tags yet". No tag names an image that was never published, so relaunching this release starts from a clean project instead of stopping on a tag that already exists.
    # Copy: http://gitlab/<lambda-user>/<project>/-/tags
    Then the project has no tag at all, so the main branch never points at a missing image
