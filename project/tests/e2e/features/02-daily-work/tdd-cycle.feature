# cspell:ignore greting
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
    # Note: A developer starts a new feature the honest way: the test first. The terminal shows, as git sees them, the two new files and the one line that registers the step file with the test suite.
    # Note: The test asks for a greeting the toolbox cannot give yet, so it is meant to fail. But look at the second line of the step file: it also asks for a helper file, ../helpers/greeting, that nobody has written yet.
    # Copy: git add -N . && git diff
    Given a developer writes the test for a greeting the toolbox cannot give yet
    # Note: One typed line does the whole check: what git sees, the test run, its exit code, the report folder, then the toolbox's check. The run is the line task project:test:e2e runs inside its test container.
    # Note: The run never reaches the test. Node stops on "Cannot find module '../helpers/greeting'", the toolbox's wrapper reports "Worker completion: FAIL", and the exit code is 1, the code a failed test returns. At a glance, this looks like the proof the method asks for.
    # Note: The report folder does not even exist, because nothing ran. The check reads that folder and refuses: "The run left no report at all: it stopped before a single scenario ran."
    # Copy: TASK_E2E_WORKERS=1 TASK_CODECEPTJS_FEATURES=./features/02-daily-work/greeting.feature task project:test:e2e -- --grep @greeting; task devsecops:test:check:red-is-real -- @greeting
    Then the run dies on its way to the test, exits like a failed test, and the toolbox refuses to call that a proof
    # Chapter: A failure that proves something
    # Note: The developer writes the missing helper, and nothing else: git now lists helpers/greeting.js next to the test, which is untouched. The greeting the test asks for still does not exist.
    # Note: Same line as the card before. This time the suite reaches the test and fails on its own check: "expected 'Hello, Lambda', got ''". The engine prints that failure twice, once for its worker and once for the whole run, and the report folder now holds results-1.xml, the record of that one scenario.
    # Note: The verdict has turned: "The failure is real: the scenario ran and failed on its own check", and it quotes that check. Nobody had to be believed: the proof was on disk, and the toolbox read it.
    # Copy: TASK_E2E_WORKERS=1 TASK_CODECEPTJS_FEATURES=./features/02-daily-work/greeting.feature task project:test:e2e -- --grep @greeting; task devsecops:test:check:red-is-real -- @greeting
    When the developer writes the missing helper, the test fails on its own check, and the toolbox accepts that failure as proof
    # Chapter: Yesterday's proof does not count
    # Note: The report of the card before is still on disk: the first ls lists results-1.xml. The developer runs the suite again with a typo in the tag, and @greting selects no scenario at all.
    # Note: The run stops at once: "No Gherkin scenario matches this selection", exit code 1. The toolbox emptied the report folder before anything else, so the second ls finds nothing.
    # Note: Asked about @greeting again, the same check now refuses. The failure it accepted a minute ago went away with its report: only the latest run counts as proof.
    # Copy: TASK_E2E_WORKERS=1 TASK_CODECEPTJS_FEATURES=./features/02-daily-work/greeting.feature task project:test:e2e -- --grep @greting; task devsecops:test:check:red-is-real -- @greeting
    Then a run that selects no scenario wipes that report, and the toolbox refuses the old failure
    # Chapter: The phase refuses to certify itself
    # Note: Asked to make the suite green, the assistant takes the cheapest road: one word, @skip, above the scenario it could not satisfy. The file on screen is the test as it now stands.
    # Note: task devsecops:test:verify is the one command that certifies the test phase: the tests passed, and nothing was switched off to get there. Its guard runs first, so it stops in a second instead of after the whole test suite.
    # Note: It names the file, the line and what that line does, then offers the only way past it: a No-cheat-exempt trailer in the commit, so a reviewer reads the reason instead of guessing it.
    # Copy: cat project/tests/e2e/features/02-daily-work/greeting.feature && task devsecops:test:verify
    Then the test phase refuses to certify itself, the moment a check is switched off
    # Note: The assistant puts the scenario back and tries a quieter road. In the suite's configuration, the picture check now accepts a difference: its tolerance goes from 0 to 0.1. The diff at the top shows that line, next to the step file the developer registered at the start.
    # Note: The guard behind the test phase reads the working tree, and it stops on that line too. It names the file and the line, and says what the line does: "a picture check that accepts a difference: it stops proving anything".
    # Copy: git diff -- project/tests/e2e/codecept.conf.js && task devsecops:test:check:no-cheat BASE=HEAD
    And the guard refuses a picture check loosened to 0.1 just the same
    # Chapter: A check that disappears
    # Note: The tolerance goes back to 0, and the developer commits the test as it stands. The assistant then takes the quietest road of all: it adds nothing and deletes the scenario's only check, the Then line. The diff at the top shows that single red line.
    # Note: A scenario with no step left has nothing that can fail. The guard reads the lines a change removes too, and stops on this one: it names the file and the line, quotes it, and says "a check removed, and none added in its place".
    # Copy: git diff -- project/tests/e2e/features/02-daily-work/greeting.feature && task devsecops:test:check:no-cheat BASE=HEAD
    Then the guard refuses a scenario that lost its only check
    # Note: The Then line goes back, and the whole test file goes instead. git status lists it with a D, for deleted.
    # Note: The guard reads what the deleted file held, and names the check that will never run again, line 5 of greeting.feature: "a test file deleted".
    # Copy: git status --short && task devsecops:test:check:no-cheat BASE=HEAD
    And the guard refuses a test file deleted whole
    # Chapter: A test that moves, and a test that goes for a reason
    # Note: Not every change to a test is a cheat. The test file comes back, and the developer gives it a better name: git status shows R, for renamed, from greeting.feature to hello.feature.
    # Note: The check on line 5 did not go anywhere: it moved with its file. The guard pairs what a change removes with what it adds, and lets this one through: "Nothing in this change switches a check off or removes one."
    # Copy: git status --short && task devsecops:test:check:no-cheat BASE=HEAD
    Then the guard lets a renamed test through, its check moved with it
    # Note: Sometimes a test really has to go. The greeting left the plans, so the developer deletes its test in a commit that says why, on a line starting with "No-cheat-exempt:". The top of the screen shows that commit: its message, then the file it deletes.
    # Note: Asked about that commit, the guard lets it through in yellow, "a 'No-cheat-exempt:' trailer waives the gate", and still names the check that goes, greeting.feature:5. Without that line, the same commit is refused. The reason now sits in the history, for a reviewer to read.
    # Copy: git show --stat --format=%B HEAD && task devsecops:test:check:no-cheat BASE=HEAD~1
    And a deleted test goes through only with its reason written in the commit


  @generated-project-red
  Scenario: A project generated by the toolbox can prove its own failing test
    # Chapter: The same proof, in a generated project
    # Note: This is a project generated by the toolbox, not the toolbox itself. The developer copies the CodeceptJS sample it ships into project/tests/application/, the folder its CodeceptJS tasks point at, and writes a first test.
    # Note: git status lists the three new files: the copied sample and the two test files, shown line by line below it. The test asks for a greeting the project cannot give yet, so it is meant to fail.
    # Copy: cp .config/codeceptjs/codecept.conf.sample.js project/tests/application/codecept.conf.js && git add -N . && git status --short && git diff -- project/tests/application/features/greeting.feature project/tests/application/step_definitions/application_steps.js
    Given a generated project copies the CodeceptJS sample and writes a test that cannot pass yet
    # Note: The test runs with the copied sample and fails on what it checks: "expected 'Hello, Lambda', got ''", exit code 1.
    # Note: The sample also writes a report of that run: the report folder now holds results-1.xml.
    # Copy: codeceptjs run --config project/tests/application/codecept.conf.js --grep @greeting; echo "exit code $?"; ls project/tests/application/_output/junit
    When the generated project runs that test and it fails on what it checks
    # Note: The same check as in the toolbox's own loop, typed in the generated project with no folder to point it at. The line task prints shows where it looks by default: REPORT_DIR=project/tests/application/_output/junit, the folder the sample writes to.
    # Note: It finds the report there and accepts the failure: "The failure is real", and it quotes the check that failed.
    # Copy: task devsecops:test:check:red-is-real -- @greeting
    Then the generated project's own check accepts that failure as proof

  @baseline-mode
  Scenario: Only an explicit local request may replace an image reference
    # Chapter: A visible difference must fail
    # Note: The page under test, as Chromium captures it: the box labelled Current is now orange. The committed reference image of this page has both boxes in blue, so the two images differ in their pixels.
    # Note: A throwaway copy of the toolbox holds that reference twice, once for each of the suite's two visual checks, and one test that compares the page with both.
    Given a reference image and a captured page differ visibly in their pixels
    # Note: Each card types the same line with another setting. First, what task project:test:e2e would hand to its test container: with the flag set to 0, the bare command, so the test never sees the flag.
    # Note: Then the test itself, run with the 0 anyway. Both checks fail on "Visual mismatch", the run exits with the code 1, and git status prints nothing: both references are untouched. No flag at all gives the same result.
    # Copy: TASK_E2E_UPDATE_BASELINES=0 task --dry project:test:e2e 2>&1 | grep -o "exec -T.* codeceptjs node"; TASK_E2E_UPDATE_BASELINES=0 codeceptjs run --features --config project/tests/e2e/codecept.conf.js --grep @baseline-probe | grep -E "mismatch|forbidden|passed"; echo "exit code ${PIPESTATUS[0]}"; git status --short project/tests/e2e/screenshots
    Then a flag set to zero, like no flag at all, is not passed on, and both checks refuse the difference
    # Note: Same line, as a CI job would run it, with the flag set to 1. The task hands the flag over together with CI=true, so the test knows where it runs.
    # Note: Both checks refuse at once, "TASK_E2E_UPDATE_BASELINES is forbidden in CI", and git sees no change. In CI, a visual difference can only fail the run.
    # Copy: CI=true TASK_E2E_UPDATE_BASELINES=1 task --dry project:test:e2e 2>&1 | grep -o "exec -T.* codeceptjs node"; CI=true TASK_E2E_UPDATE_BASELINES=1 codeceptjs run --features --config project/tests/e2e/codecept.conf.js --grep @baseline-probe | grep -E "mismatch|forbidden|passed"; echo "exit code ${PIPESTATUS[0]}"; git status --short project/tests/e2e/screenshots
    And in CI the flag set to 1 reaches the test with CI set, and both checks refuse to rewrite anything
    # Chapter: A developer rewrites the references, a reviewer accepts them
    # Note: Same line on the developer's machine, with the flag set to 1. The task hands the flag over, and both checks pass: each one wrote the captured page over its reference.
    # Note: git status now lists the two references as modified. Nothing is accepted yet: someone still has to look at them.
    # Copy: TASK_E2E_UPDATE_BASELINES=1 task --dry project:test:e2e 2>&1 | grep -o "exec -T.* codeceptjs node"; TASK_E2E_UPDATE_BASELINES=1 codeceptjs run --features --config project/tests/e2e/codecept.conf.js --grep @baseline-probe | grep -E "mismatch|forbidden|passed"; echo "exit code ${PIPESTATUS[0]}"; git status --short project/tests/e2e/screenshots
    When the flag is exactly 1 on the developer's machine, both references are rewritten with the captured pixels
    # Note: The developer commits the two references on a branch and opens a merge request, a change a reviewer accepts or refuses. For each image, GitLab shows the old reference, all blue, next to the new capture with its orange box.
    # Note: That is the only road for a new reference: rewritten on a developer's machine, then looked at by a person before it reaches the main branch.
    # Copy: http://gitlab/<user>/<project>/-/merge_requests/1/diffs
    Then the merge request shows each old reference next to its new pixels, for a reviewer to accept

  @worker-completion
  Scenario: Every selected scenario must finish before a parallel run can succeed
    # Chapter: A worker can disappear before its result exists
    # Note: A throwaway copy of the toolbox gets three test files and one step file. One scenario's only step ends its own worker with the code 23 when WORKER_PROBE_STOP is 1, the way a crash would. Two examples always pass. The third file, Outside this shard, must never run.
    # Note: The export selects worker-stopped.feature and worker-completed.feature, the way a CI shard does, and turns the crash on for the rest of the session.
    # Copy: export TASK_CODECEPTJS_FEATURES=./features/worker-stopped.feature,./features/worker-completed.feature WORKER_PROBE_STOP=1 && cat project/tests/e2e/features/worker-*.feature project/tests/e2e/support/steps/worker-probe.js
    Given parallel test files contain an interruptible worker and two completing examples
    # Note: The selected scenarios run twice, with two workers. First the engine alone: it loses a worker, "Worker exited with code 23", and still exits with the code 0 after "OK | 2 passed". A pipeline would call that a success.
    # Note: Then the line task project:test:e2e really runs: the same engine inside the toolbox's guard. The guard counts 2 of the 3 selected scenarios finished, names the missing one and exits with the code 1.
    # Note: Off camera, the guard refuses the same way when the interrupted scenario runs alone, and when an earlier successful run left its reports behind: it empties the report folder first.
    # Copy: codeceptjs run-workers 2 --features --by pool --config project/tests/e2e/codecept.conf.js > engine.log; echo "exit code $?"; tail -n 1 engine.log; node project/tests/e2e/support/helpers/workerCompletion.js /usr/local/bin/codeceptjs run-workers 2 --features --by pool --config project/tests/e2e/codecept.conf.js > guarded.log; echo "exit code $?"; tail -n 3 guarded.log
    When a worker exits early, the engine alone still says OK, and the toolbox guard fails the same run
    # Chapter: A complete selection still passes
    # Note: The guard follows the real selection, not every scenario of the repository. A grep on the two examples passes, 2 of 2, and so does the inverse grep that leaves the interrupted scenario out.
    # Note: The interrupted scenario is never selected, so no worker stops, and the third file stays out as the export said.
    # Copy: node project/tests/e2e/support/helpers/workerCompletion.js /usr/local/bin/codeceptjs run-workers 2 --features --by pool --config project/tests/e2e/codecept.conf.js --grep @worker-ok; node project/tests/e2e/support/helpers/workerCompletion.js /usr/local/bin/codeceptjs run-workers 2 --features --by pool --config project/tests/e2e/codecept.conf.js --grep @worker-stop --invert
    Then complete selections pass with either a grep filter or its inverse

  @junit-control-characters
  Scenario: GitLab can read a real failure report even when assertions contain terminal colours
    # Chapter: GitLab reads the report of a merge request
    # Note: A merge request adds three probe scenarios to a throwaway copy of the toolbox, with the steps behind them. One passes. Two fail with the same message: quotes, an accent, an emoji, a tab and a line break included.
    # Note: The last step also wraps its message in terminal colours, the escape code before [31m, and adds every control character XML forbids: the kind of text a test tool really prints.
    # Copy: http://gitlab/<user>/<project>/-/merge_requests/1/diffs
    Given a merge request adds one passing scenario, one plain failure and one failure in terminal colours
    # Note: The merge request's pipeline runs the three scenarios with the toolbox's own test engine and JUnit reporter, on the very image the test suite runs in, and hands the report to GitLab.
    # Note: GitLab reads it without a complaint: 3 tests, 2 failures, 0 errors, and one line per scenario on the junit-probes suite.
    # Copy: http://gitlab/<user>/<project>/-/pipelines/<id>/test_report
    When its pipeline runs the three scenarios, and GitLab counts one pass and two failures
    # Note: The details of the coloured failure, as a reviewer opens them on that tab. The message reads as it was written, with no escape code and none of the forbidden characters.
    # Copy: http://gitlab/<user>/<project>/-/pipelines/<id>/test_report
    Then GitLab shows the coloured failure as readable text, without the terminal colours
    # Chapter: The RED gate reads the same report
    # Note: The same three scenarios, run on the developer's machine, leave the same report in project/tests/e2e/_output/junit. The RED gate reads it and accepts the coloured failure as real: the scenario ran and failed on its own check.
    # Note: It quotes that check on one readable line: the line break and the tab become spaces, and nothing of the colours is left.
    # Copy: ls project/tests/e2e/_output/junit && task devsecops:test:check:red-is-real -- @report-colour
    And the RED guard still accepts the coloured assertion as a genuine failure
