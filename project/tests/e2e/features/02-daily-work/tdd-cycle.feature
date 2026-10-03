@e2e
Feature: The toolbox checks the test really failed first, instead of taking anyone's word for it
  As a maintainer whose repository is written by people and by AI assistants alike
  I want the toolbox to check on its own the proof its method asks for
  So that "the test failed before the code was written" is a fact on disk, not a claim

  # The method of this repository is always the same three steps: write the test,
  # watch it fail, then write the code that makes it pass. Everything rests on the
  # middle step. A test that was never seen failing proves nothing about the code
  # that came after it, so the failure is the proof, and until now that proof was
  # taken on trust — a developer, or an AI assistant, simply said "it failed".
  #
  # The trouble is that a test run can fail for a reason that has nothing to do
  # with the test. When a test file asks for a helper that does not exist yet, the
  # run dies while it is still loading files, before a single scenario has been
  # tried. It prints an error, it exits like a failed test, and it looks exactly
  # like the proof the method asks for. It is not one.
  #
  # This story runs both of those failures for real, on a throwaway copy of the
  # framework, and shows the toolbox telling them apart.
  #
  # ONE sentence = ONE card = ONE pixel baseline (tolerance: 0); every card is
  # real captured output, twinned in the step with a check of the same fact.
  @tdd-cycle
  Scenario: The toolbox tells a real failure apart from a run that died on its way to the test
    # Chapter: A failure that proves nothing
    # Note: A developer starts a new feature the honest way: the test first. Two files are new here, and the picture is their whole content, line by line.
    # Note: The test asks for a greeting the toolbox cannot give yet, so it is meant to fail. But look at the second line of the step file: it asks for a helper file, ../helpers/greeting, that has not been written yet either.
    # Copy: git add -N . && git diff
    Given a developer writes the test for a greeting the toolbox cannot give yet
    # Note: The test suite is started, and it never reaches the test. Node stops on the missing helper: "Cannot find module '../helpers/greeting'", and names the file that asked for it.
    # Note: The run then exits with the code 1, which is the same code a genuinely failed test returns. On a screen, at a glance, this looks like the proof the method asks for.
    # Note: The last line is the tell. The suite writes a report of every scenario it ran into project/tests/e2e/_output/junit/, and here that folder does not even exist. Nothing ran.
    # Copy: TASK_CODECEPTJS_FEATURES=./features/02-daily-work/greeting.feature codeceptjs run-workers 1 --features --by pool --config project/tests/e2e/codecept.conf.js --grep '@greeting'
    Then the run dies on its way to the test, and still exits like a failed test
    # Note: This is the new check, and this is the command a developer types: task devsecops:test:check:red-is-real -- @greeting. It reads the report the run left behind, and it finds none.
    # Note: Its verdict says so in plain words: "no report at all: the run stopped before a single scenario". The toolbox refuses to accept this failure as proof, and says what it would take instead.
    # Copy: task devsecops:test:check:red-is-real -- @greeting
    Then the toolbox refuses to call that a proof, because no scenario was ever recorded
    # Chapter: A failure that proves something
    # Note: The developer writes the missing helper, and nothing else. The test is untouched, and the greeting it asks for still does not exist.
    # Note: Same command as two pictures ago, and this time the suite reaches the test: "0 passed, 1 failed". The scenario ran, and it failed on what it was checking, in its own words: expected 'Hello, Lambda', got ''.
    # Note: The report folder now holds results-1.xml, the record of that one scenario.
    # Copy: TASK_CODECEPTJS_FEATURES=./features/02-daily-work/greeting.feature codeceptjs run-workers 1 --features --by pool --config project/tests/e2e/codecept.conf.js --grep '@greeting'
    When the missing helper is written and the test finally reaches its own check
    # Note: Same check as two pictures ago, same command, and the verdict has turned: "the scenario ran and failed on its own check".
    # Note: It quotes the sentence of the scenario it found in the report, and the failure that scenario recorded. The developer never had to be believed: the proof was on disk, and the toolbox read it.
    # Copy: task devsecops:test:check:red-is-real -- @greeting
    Then the toolbox accepts the failure as proof, and quotes the check that produced it
    # Chapter: The phase refuses to certify itself
    # Note: The assistant is asked to make the suite green, and it takes the cheapest road there: one word, @skip, above the scenario it could not satisfy. The suite will now report that scenario without ever running it.
    # Note: Each phase of the loop has one command that settles it. For the test phase it is this one, and it answers with a single exit code: the tests passed, and nothing was switched off to get there. The guard runs first, so this stops in a second instead of after twenty minutes of test suite.
    # Note: It names the file, the line and what that line does, then offers the only way past it: a visible No-cheat-exempt trailer in the commit, so a reviewer reads the reason instead of guessing at it.
    # Copy: task devsecops:test:verify
    Then the test phase refuses to certify itself, the moment a check is switched off


  @baseline-mode
  Scenario: Only an explicit local request may replace an image reference
    # Chapter: A visible difference must fail
    # Note: The reference contains two blue rectangles. Chromium then captures the same page with an orange rectangle on the right. The fixture keeps both real captures in a disposable copy of the toolbox.
    Given a reference image and a captured page differ visibly in their pixels
    # Note: With no regeneration variable, both visual helpers must reject the changed pixels. The task preview shows the actual container command; the real engine output below shows each failed comparison. Neither reference file may change.
    # Copy: env -u TASK_E2E_UPDATE_BASELINES task project:test:e2e
    Then an unset regeneration flag refuses the pixel difference and preserves the reference
    # Note: Setting the variable to 0 must keep the same strict behavior. A nonempty value is not permission to accept a visual regression, and the task must not turn that value into 1.
    # Copy: TASK_E2E_UPDATE_BASELINES=0 task project:test:e2e
    And a regeneration flag set to zero still refuses the difference and preserves the reference
    # Chapter: Regeneration requires an explicit local request
    # Note: The value 1 authorizes regeneration in this disposable local copy. Each helper must succeed and replace its blue reference with the exact bytes of the newly captured page.
    # Copy: TASK_E2E_UPDATE_BASELINES=1 task project:test:e2e
    And an explicit local regeneration request replaces the reference with the captured pixels
    # Note: The same nested engine now receives CI=true. Both helpers must print their CI refusal and leave the reference untouched, even though the regeneration variable is 1. This checks the runtime guard locally; it does not run a GitLab pipeline.
    # Copy: CI=true TASK_E2E_UPDATE_BASELINES=1 task project:test:e2e
    And the same explicit regeneration request is forbidden in CI and preserves the reference

  @worker-completion
  Scenario: Every selected scenario must finish before a parallel run can succeed
    # Chapter: A worker can disappear before its result exists
    # Note: These disposable features use the real CodeceptJS engine and the repository JUnit reporter. One step exits its own worker; a second feature has two Outline examples. A third file outside the shard throws if it is selected accidentally.
    Given parallel test files contain an interruptible worker and two completing examples
    # Note: The real engine runs twice: first with the interruptible feature alone, then alongside the completing examples. Each run loses a worker. Before testing the task entrypoint, a genuine successful run leaves earlier JUnit reports behind, including the scenario that will now be interrupted.
    When a worker exits early both alone and alongside a worker that completes its examples
    # Chapter: A current and complete result is required
    # Note: The task must refuse both incomplete executions, even when the engine returns zero and even when an earlier launch passed. Its verdict names the missing scenario. Worker reports from the earlier launch must be gone.
    Then the task rejects both incomplete runs and cannot reuse earlier successful reports
    # Note: Selecting only the completing examples with grep succeeds; inverting a grep for the interrupted scenario selects the same two examples. The feature list still excludes the third file. The guard must follow those real selections, not demand every feature in the repository.
    And complete selections pass with either a grep filter or its inverse

  @junit-freshness
  Scenario: A launch that cannot reach its scenarios cannot reuse an earlier report
    # Chapter: An earlier failure is not proof for the next launch
    # Note: A disposable scenario really fails on an assertion. The repository's reporter writes its failure, and the RED gate accepts that current evidence.
    Given an earlier launch has a genuine failed scenario and accepted RED evidence
    # Note: The next launch throws while loading its configuration, before it can execute any scenario. This uses the engine command from the task's own preview.
    When the next launch crashes before loading its scenarios
    # Note: The same RED command must now refuse the proof. The previous report must be gone, even though configuration loading failed before a new report could be written.
    Then the RED gate refuses the old failure and no worker report remains
    # Chapter: A filter that selects nothing is an error
    # Note: A real successful launch seeds reports again. A filter matching no scenario must fail clearly and leave no result from that earlier launch.
    And a zero-match filter fails clearly and removes earlier reports
