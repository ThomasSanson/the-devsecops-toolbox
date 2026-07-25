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
    # Chapter: A framework change that brings no proof card
    # Note: Everything this framework ships lives in files under .config/. This merge request touches one of them, .config/gitlab/ci/devsecops/release.yml, and the Changes tab shows all of it: one file, two added lines.
    # Note: The rule of the house is that a change like this arrives with a proof card — a real screenshot the test suite takes to show the change doing its job. Look at the file list on the left: nothing under project/tests/. No card came with it.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1/diffs
    Given the merge request changes one framework file and brings no proof card
    # Note: GitLab runs the merge request's pipeline on every push. Two jobs passed here, and one turned red: storyboard-coverage, the job that enforces the rule.
    # Note: So the merge request is stopped. The box reads "Merge blocked: 1 check failed", and right under it the reason: "Pipeline must succeed." Nobody had to notice the missing proof. The project refused the change on its own.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    Then GitLab refuses to merge it, one check failed
    # Note: A red job is useless if it does not say why, so the author clicks it open. The job's own log spells the verdict out: "Product changed with NO storyboard picture to prove it", then names the file it caught.
    # Note: It also says what counts as a proof, and it is strict: the picture the card captures, under project/tests/e2e/screenshots/base/. A comment written next to a card is not one. Or, when a change genuinely has nothing to show, a line starting with "Storyboard-exempt:" in the commit message, so the reviewer reads the reason instead of guessing at it.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<id>
    And the failed job names the file left without proof
    # Note: First reflex, the cheapest one: type a line of text into an existing card and call it done. The Changes tab now holds two files, and the diff of that card is a single comment line. Still nothing under screenshots/base: no picture was taken.
    # Note: It costs one second, it proves nothing, and a rule written in a document cannot stop it.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1/diffs
    When the author pushes only a comment beside the framework change
    # Note: Same job, same page as two cards ago, new push. The verdict has not moved by a word: "Product changed with NO storyboard picture to prove it".
    # Note: And it now names the file it just read: "A storyboard file changed, but it captured no picture — text is not proof". The gate looked at the comment and refused it. It does not count files, it looks for a photograph, and a comment is text anyone can type in a second.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<id>
    Then the gate reads that comment and refuses it just the same
    # Note: The author pushes the missing card to the same merge request, and changes nothing else. The Changes tab now lists three files: the framework file from before, untouched, the sentence added to the card, and the picture that sentence captured.
    # Note: That picture is what the gate actually wants. A screenshot only exists because the test really ran and photographed something, so a comment typed next to a card can never stand in for it.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1/diffs
    When the author adds the card and the picture it captured
    # Note: The very same job runs again on the new push, and this time it reads Passed. Its log carries the opposite verdict: "Product changed and a storyboard captured it".
    # Note: The gate never leaves the reader guessing. It names the picture that made it green, so a reviewer can go and look at it for themselves.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<id>
    Then the same job turns green and names the card that proved the change
    # Note: Back on the merge request, every job is green and the block is gone. The Merge button is there, ready: the change that was refused a minute ago can now go in.
    # Note: Nothing about the framework change moved between those two states. The only difference is that it now arrives with its picture, which is the whole point of the rule.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    And the merge request is green from end to end and can be merged
    # Chapter: The card is there, and the test behind it was switched off
    # Note: One last push, and the Changes tab shows all of it: a single line added to the card, right above the scenario. It reads @skip.
    # Note: That word tells the test suite to walk past this scenario without running it. The scenario is still written down, the picture is still committed, and from now on neither is ever checked again.
    # Note: It is the cheapest way to turn a red pipeline green, and it is why a rule written in a document is not enough.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1/diffs
    When the author switches the test off instead of fixing what it caught
    # Note: The picture check runs on that push and passes. Its log says so: "Product changed and a storyboard captured it", and it names the picture.
    # Note: It is not wrong. It was asked one question — did a picture come with this change — and the answer is still yes. What it cannot see is that the scenario taking that picture will never run again.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<id>
    Then the picture check is satisfied: the card and its picture are both still there
    # Note: The second check reads the change itself, line by line, and stops on the one that was added: "This change switches a check off instead of fixing what it caught".
    # Note: It names the file and the line number, quotes the line, and says in plain words what it does: "a skipped scenario: the suite reports it without ever running it".
    # Note: The last lines offer the only way past it, and it is a visible one: a line starting with "No-cheat-exempt:" in the commit message, so a reviewer reads the reason instead of guessing at it.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<id>
    And the second check reads the change itself and names the line that switched the test off
    # Note: Back on the merge request, the same box as before: "Merge blocked: 1 check failed", "Pipeline must succeed". The change is stopped again, and this time the picture had nothing to do with it.
    # Note: Two checks, two questions. Did the change bring a picture. And does the test behind that picture still run. A change has to answer both before it reaches the main branch.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    Then GitLab stops the merge request again, on the check a picture cannot satisfy
