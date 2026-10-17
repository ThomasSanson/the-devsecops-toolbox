# cspell:ignore greting ECONNREFUSED
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
    # Note: The tolerance goes back to 0. Many projects write their unit tests for node:test, the test runner built into Node. The assistant writes the greeting check that way, in greeting.test.js, and switches it off with one option on line 4: { skip: true }. node:test then reports the test as skipped and never runs it.
    # Note: The guard stops on that line as well. It names project/tests/unit/greeting.test.js:4 and says what the line does: "a skipped or todo test: its failure no longer fails the suite". Off camera, it also refuses { todo: true }, test.todo(, and t.skip( or t.todo( whether on a line of their own or on the test( line, and lets a skip through when its value is a condition a reviewer can read.
    # Copy: cat project/tests/unit/greeting.test.js && task devsecops:test:check:no-cheat BASE=HEAD
    And the guard refuses a node:test unit test switched off with { skip: true }
    # Chapter: A check that disappears
    # Note: The developer commits the test as it stands. The assistant then takes the quietest road of all: it adds nothing and deletes the scenario's only check, the Then line. The diff at the top shows that single red line.
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

  @agent-run
  Scenario: An assistant runs its tasks through one entry point that keeps each task's own verdict
    # Chapter: One entry point, the task's own exit code
    # Note: A developer's project, as git sees it. project/Taskfile.yml gains a task of its own, project:test:unit, which hands its arguments to Node's built-in test runner.
    # Note: Two tests come with it. greeting.test.js expects "Hello, Lambda" from src/greeting.js, which still returns nothing: the code is not written yet. service.test.js waits an hour for an answer that never comes.
    # Copy: git add -N . && git diff
    Given a project has a unit test task, one test still waiting for its code and one test that never ends
    # Note: The assistant hands the task to task devsecops:agent:run, with -x so the task's exit code comes through. The runner starts it from the root of the repository and sends everything it prints to a log of its own, under tmp/agent-runs.
    # Note: Then it prints the status file of the run: the task, "state: finished", "exit_code: 0" and the path of the log. The shell agrees, exit code 0, and the log holds the check's own words, "Nothing in this change switches a check off."
    # Copy: task -x devsecops:agent:run -- devsecops:test:check:no-cheat BASE=HEAD; echo "exit code $?"; cat tmp/agent-runs/latest/output.log
    When the assistant runs a passing check through the runner, and the status file and the shell both say 0
    # Note: Same runner, now the expected RED: the greeting test, which fails until the code is written. Node's test runner exits with 1, and that 1 comes back as it is, in the status file and in the shell.
    # Note: The log says why: the test "greets the developer by name" expected 'Hello, Lambda' and got ''. Both of Task's "Failed to run task" lines carry the same exit status 1.
    # Copy: task -x devsecops:agent:run -- project:test:unit -- project/tests/unit/greeting.test.js; echo "exit code $?"; cat tmp/agent-runs/latest/output.log
    Then the expected RED comes back with the test's own exit code, 1
    # Chapter: Nothing typed after the run can change its verdict
    # Note: The assistant switches the greeting test off: test.skip, on line 5. The same check now refuses the change, and the line ends in a pipe into tail, the habit that used to hide failures.
    # Note: The shell prints exit code 0, the exit code of tail. The status file of the run, printed last, still says "exit_code: 1": the pipe changed what the shell saw, not the verdict.
    # Copy: grep -n "test.skip" project/tests/unit/greeting.test.js && task -x devsecops:agent:run -- devsecops:test:check:no-cheat BASE=HEAD | tail -n 2; echo "exit code $?"; cat tmp/agent-runs/latest/status
    Then a refused check stays 1 in the status file, even when a pipe hands the shell a 0
    # Note: The last test never ends. With the time limit set to 3 seconds, the runner stops it and says so: "state: timed-out" and "exit_code: 124". The shell sees 124 too, never 0.
    # Note: The last lines come from the log of the run: Node's test runner reports service.test.js "Interrupted while running".
    # Note: Off camera, the status file is read while the test still runs. It says "state: running" with no exit code: a run that never comes back never reads as a success.
    # Copy: TASK_DEVSECOPS_AGENT_RUN_TIMEOUT=3 task -x devsecops:agent:run -- project:test:unit -- project/tests/unit/service.test.js; echo "exit code $?"; grep -A2 "Interrupted while running" tmp/agent-runs/latest/output.log
    Then a test that never ends is stopped at the time limit and comes back 124, never 0

  @own-gitlab
  Scenario: The test suite works only with the GitLab of its own project, and stops when that GitLab is missing
    # Chapter: Two GitLabs on one machine
    # Note: One machine can run several Docker Compose projects at once: this toolbox, a project made from it, or an unrelated one. Docker Compose labels each container with its project and its service, and two projects can both have a service called gitlab.
    # Note: Three throwaway containers set that scene. e2e-ours-gitlab-1 and e2e-neighbour-gitlab-1 stand in for the GitLabs of two projects. e2e-ours-codeceptjs-1 stands in for the container that runs the test suite, in the project e2e-ours.
    # Copy: docker ps --filter label=io.digital-commons.e2e.run=own-gitlab --format 'table {{.Names}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.service"}}'
    Given two Docker Compose projects on the same machine each run a service called gitlab
    # Note: The test suite finds its GitLab with one helper, composeService, in project/tests/e2e/support/helpers/docker.js. The helper reads the project of its own container, then asks Docker for the gitlab service of that project only.
    # Note: Run in the suite's container, it answers e2e-ours-gitlab-1: the GitLab of its own project, not the neighbour's.
    # Copy: docker exec e2e-ours-codeceptjs-1 node -e "const { composeService } = require('./project/tests/e2e/support/helpers/docker'); try { console.log(composeService('gitlab')) } catch (error) { console.log(error.message) }"
    When the test suite asks for its GitLab, it gets the one of its own project
    # Chapter: No GitLab of its own, no GitLab at all
    # Note: docker stop prints the name of our GitLab, e2e-ours-gitlab-1, and only the neighbour's is still running. The same question now gets a refusal instead of a name, in the helper's words: No "gitlab" service is running in the Compose project "e2e-ours".
    # Note: Stopping is the safe answer. The suite creates an admin token and registers runners on the GitLab it is given, so the neighbour's would get them.
    # Note: Off camera, a suite container whose project label is empty is refused too: the helper cannot tell which project is its own, and it does not guess.
    # Copy: docker stop e2e-ours-gitlab-1 && docker exec e2e-ours-codeceptjs-1 node -e "const { composeService } = require('./project/tests/e2e/support/helpers/docker'); try { console.log(composeService('gitlab')) } catch (error) { console.log(error.message) }"
    Then with its own GitLab stopped, the test suite refuses to use the neighbour's

  @build-coverage-under-tmp
  Scenario: The build check reads a repository that sits under /tmp, and still skips its tmp folders
    # Note: A copy of the toolbox's own repository, placed under /tmp the way a quick clone often is: pwd prints /tmp/e2e-build-coverage. The developer adds a web service, project/web/docker-compose.yml, and writes no task to build it.
    # Note: A scratch copy of that file sits in project/tmp. git status marks the new service "??", a file git does not track yet, and the scratch copy "!!", a file git ignores: the repository's .gitignore holds the line tmp/.
    # Copy: pwd && git status --short --ignored --untracked-files=all project/web project/tmp
    Given a repository under /tmp adds a web service with no build task, and keeps a scratch copy in a tmp folder
    # Note: The build check is one of the checks task test runs first. It prints "6 Docker Compose file(s) found": the five the toolbox already had, each with the task that builds it, project:build:gitlab for instance, and the new web service.
    # Note: The web service has none: "Missing task: project:build:web", and the check fails with the exit code 201, the code Task gives a failed command. The scratch copy in project/tmp is not in the list.
    # Note: The check reads each .gitignore line against paths inside the repository only. The line tmp/ leaves out project/tmp, and never the /tmp folder the repository sits in.
    # Copy: task devsecops:test:check:build-coverage; echo "exit code $?"
    Then the build check finds the web service, refuses it without its build task, and leaves the scratch copy out

  @red-evidence
  Scenario: The RED gate counts only a failure that reached the test's own check
    # Chapter: A refused connection is not a failing test
    # Note: A developer writes two tests for one greeting and tags both @greeting. The first asks a greeting service at 127.0.0.1:9 for the text, but nobody started that service. The second checks the greeting the toolbox gives, and nobody has written that greeting yet.
    # Note: Only the second test can show that code is missing. The first one fails whatever the code does, because the service it needs is not there.
    # Copy: cat project/tests/e2e/features/greeting.feature project/tests/e2e/support/steps/greeting.js
    Given a developer writes one test that needs a service nobody started, and one that checks a greeting nobody wrote
    # Note: One run of both tests, with the line task project:test:e2e runs inside its test container. The first test stops on "connect ECONNREFUSED 127.0.0.1:9": nothing answered at that address. The second fails on its own check: "expected 'Hello, Lambda', got ''".
    # Note: The run exits with the code 1 and leaves results-1.xml in the report folder, with both failures in it. From the exit code alone, nobody can tell the two failures apart.
    # Copy: TASK_E2E_WORKERS=1 TASK_CODECEPTJS_FEATURES=./features/greeting.feature task project:test:e2e; echo "exit code $?"; ls project/tests/e2e/_output/junit
    When both tests run and fail, one on the refused connection and one on its own check
    # Note: The RED gate reads that report for @greeting-service. It finds the failure, sees a refused connection in it, and refuses it: the test stopped before it checked anything.
    # Copy: task devsecops:test:check:red-is-real -- @greeting-service
    Then the toolbox refuses the failure caused by the refused connection
    # Note: The same command for @greeting-text, on the same report. This test ran up to its check and failed there, so the gate accepts the failure and quotes that check.
    # Copy: task devsecops:test:check:red-is-real -- @greeting-text
    And the toolbox accepts the failure on the test's own check
    # Chapter: One scenario, in one whole report
    # Note: The tag @greeting is on both tests. The gate cannot know which of the two the developer means, so it refuses and lists them. Each test already has a tag of its own for that.
    # Copy: task devsecops:test:check:red-is-real -- @greeting
    Then a tag that names both tests is refused
    # Note: A run killed while it writes its report leaves the file cut in the middle. truncate removes the last 20 bytes of results-1.xml, and tail shows its last three lines: the failure of @greeting-text is still there, word for word, but the file now ends in the middle of a tag.
    # Note: The gate refuses it anyway. A report that does not close is not the record of a whole run.
    # Copy: truncate -s -20 project/tests/e2e/_output/junit/results-1.xml && tail -n 3 project/tests/e2e/_output/junit/results-1.xml; echo; task devsecops:test:check:red-is-real -- @greeting-text
    And a report cut short is refused, even though the failure is still in it
