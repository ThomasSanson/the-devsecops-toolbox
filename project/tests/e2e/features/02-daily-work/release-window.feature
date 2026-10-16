@e2e
Feature: A release that fails leaves nothing broken behind
  As a maintainer of the project
  I want a failed release to leave neither the main branch open nor a tag without its image or its version commit
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
  # The tag and the version commit must stay in step too. The third chapter
  # lets a teammate's merge move the main branch while a release runs, so the
  # version commit cannot be pushed, and proves its tag stays behind with it.
  # The fourth relaunches that release and proves it pushes the version commit
  # and its own tag together, and no other tag.
  #
  # ONE sentence = ONE card = ONE pixel baseline (tolerance: 0); every card is a
  # real GitLab page, twinned with a REST/log check of the same fact.
  @release-window
  Scenario: a crashed release leaves the main branch locked, pushes no tag on its own, and its relaunch publishes the version commit with its tag
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
    # Chapter: A rejected push publishes nothing
    # Note: A third release starts on the commit "feat: scaffold the project from the devsecops toolbox", in the Commit box on the right. While it waits for its runner, a teammate's change lands on the main branch, so the main branch has moved on before the release job starts.
    # Note: The release job cuts version 0.2.0 on top of that older commit, and the project's own publish step keeps a tag of its own, "Tagged the image build image-0.2.0, a tag for this job only.". Git rejects the version commit, "HEAD -> main (non-fast-forward)", because the main branch moved on, and rejects its tag with it, "0.2.0 -> 0.2.0 (atomic push failed)": the push sends both or nothing. image-0.2.0 is not part of the push at all.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<id>
    When a teammate's change moves the main branch while a third release waits, so the release job's push is rejected and sends neither the version commit nor its tag
    # Note: The tags page of the project still reads "Repository has no tags yet". No tag points at a version commit the main branch never received, so version 0.2.0 is still free for the next release.
    # Copy: http://gitlab/<lambda-user>/<project>/-/tags
    Then the project still has no tag after the rejected push
    # Chapter: The relaunched release pushes its version commit and its tag together
    # Note: The same release job page, for the release relaunched on the updated main branch: its Commit box now reads "docs: explain how to contribute", the teammate's change. It cuts version 0.2.0 again, and one push carries "HEAD -> main" and "[new tag] 0.2.0 -> 0.2.0", nothing else: image-0.2.0 stays in the job.
    # Note: The release job ends on "Job succeeded" and a green Passed pill. Its pipeline reads Canceled only because the story stops the other jobs of that pipeline, which it does not need.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<id>
    When the release is relaunched on the updated main branch and pushes its version commit and its tag together
    # Note: The tags page now lists one tag, 0.2.0, on "build: bump version 0.1.0 → 0.2.0", the version commit at the tip of the main branch. image-0.2.0, the tag the publish step kept in the job, never reached GitLab.
    # Copy: http://gitlab/<lambda-user>/<project>/-/tags
    Then the project has exactly one tag, 0.2.0, on the version commit at the tip of the main branch
