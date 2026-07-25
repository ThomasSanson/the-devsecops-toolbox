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
  # This story runs that job for real, on a real merge request, and watches it
  # stop a change and then let the same change through.
  #
  # ONE sentence = ONE card = ONE pixel baseline (tolerance: 0); every card is a
  # real GitLab page, twinned with a REST check of the same fact.
  @test-discipline
  Scenario: GitLab stops a framework change that ships with no proof card, and lets it through once the card is added
    # Note: The Changes tab of the merge request, the page a reviewer opens first. It holds exactly one file, .config/gitlab/ci/devsecops/release.yml, part of the framework this project ships. Nothing under project/tests/ is here: the change arrives with no proof card at all.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1/diffs
    Given the merge request changes one framework file and brings no proof card
    # Note: GitLab will not let that in. The merge box reads "Merge blocked: 1 check failed", and the reason underneath is "Pipeline must succeed." Nothing here depends on a reviewer noticing the missing proof, the project refuses the change on its own.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    Then GitLab refuses to merge it, one check failed
    # Note: A red job is useless if it does not say why, so the author opens it. The storyboard-coverage job spells out its verdict, "Product changed with NO storyboard card changed or added", then names the file it caught. It also gives the two ways forward: add a card under project/tests/e2e/features/, or, when a change genuinely has nothing to show, write a "Storyboard-exempt:" line in the commit message so the reviewer reads the reason.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<id>
    And the failed job names the file left without proof
    # Note: The author pushes the missing proof card to the same merge request. The Changes tab now holds two files: the framework file, untouched since the first push, and beside it the card that pictures what it does, project/tests/e2e/features/02-daily-work/release-window.feature.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1/diffs
    When the author adds the proof card beside the same framework change
    # Note: The very same storyboard-coverage job now reads Passed, with the opposite verdict: "Product changed and a storyboard was changed/added", followed by the card that satisfied it. The change can go in, and it goes in with its picture.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<id>
    Then the same job turns green and the change can go in
