@e2e
Feature: A framework change without its proof card never reaches the main branch
  As a maintainer who cannot review every change with their own eyes
  I want GitLab itself to stop a merge request that changes the framework
  without adding the picture that proves the change
  So that the rule of this repository holds even when nobody is watching

  # Everything this framework ships lives in files under .config/. The rule of
  # the house: any change there arrives with a proof card, a real screenshot the
  # test suite takes to show the change doing its job. A rule written in a
  # document is easy to skip, so a GitLab job named storyboard-coverage enforces
  # it on every merge request: it compares the merge request against the main
  # branch and fails when the framework moved and no proof card moved with it.
  # This story opens a REAL merge request and watches that job stop it, then let
  # the very same change through once the card is there.
  #
  # ONE sentence = ONE card = ONE pixel baseline (tolerance: 0); every card is a
  # real GitLab page, twinned with a REST check of the same fact.
  @test-discipline
  Scenario: GitLab stops a framework change that ships with no proof card, and lets it through once the card is added
    # Note: Everything this framework ships lives in files under .config/. This merge request touches one of them, .config/gitlab/ci/devsecops/release.yml, and the Changes tab shows all of it: one file, two added lines.
    # Note: The rule of the house is that a change like this arrives with a proof card — a real screenshot the test suite takes to show the change doing its job. Look at the file list on the left: nothing under project/tests/. No card came with it.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1/diffs
    Given the merge request changes one framework file and brings no proof card
    # Note: GitLab runs the merge request's pipeline on every push. Two jobs passed here, and one turned red: storyboard-coverage, the job that enforces the rule.
    # Note: So the merge request is stopped. The box reads "Merge blocked: 1 check failed", and right under it the reason: "Pipeline must succeed." Nobody had to notice the missing proof. The project refused the change on its own.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    Then GitLab refuses to merge it, one check failed
    # Note: A red job is useless if it does not say why, so the author clicks it open. The job's own log spells the verdict out: "Product changed with NO storyboard card changed or added", then names the file it caught.
    # Note: It also gives the two ways forward. Add a card under project/tests/e2e/features/. Or, when a change genuinely has nothing to show, write a line starting with "Storyboard-exempt:" in the commit message, so the reviewer reads the reason instead of guessing at it.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<id>
    And the failed job names the file left without proof
    # Note: The author pushes the missing card to the same merge request, and changes nothing else. The Changes tab now lists two files: the framework file from before, untouched, and beside it the card that pictures what it does.
    # Note: That card is project/tests/e2e/features/02-daily-work/release-window.feature, the story where a release job crashes and the main branch locks itself again anyway. It is exactly the picture this change owed.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1/diffs
    When the author adds the proof card beside the same framework change
    # Note: The very same job runs again on the new push, and this time it reads Passed. Its log carries the opposite verdict: "Product changed and a storyboard was changed/added".
    # Note: The gate never leaves the reader guessing. It names the file that made it green, so a reviewer can go and look at that card for themselves.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<id>
    Then the same job turns green and names the card that proved the change
    # Note: Back on the merge request, every job is green and the block is gone. The Merge button is there, ready: the change that was refused a minute ago can now go in.
    # Note: Nothing about the framework change moved between those two states. The only difference is that it now arrives with its picture, which is the whole point of the rule.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    And the merge request is green from end to end and can be merged
