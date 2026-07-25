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
  @agent-harness
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
    # Chapter: The tool that drives the cycle is chosen, never built in
    # Note: The toolbox can hand each step of this cycle to an AI assistant, and it names none of them. Each tool a machine holds is one small file dropped in .config/devsecops/agents.d/, and this machine holds one, called pocket-oracle.
    # Note: The toolbox found the command that file declares, then asked the tool itself which models it offers. It answered two, oracle-small and oracle-large. No model name is written anywhere in the framework, so nothing here can go out of date.
    # Note: The tool on this machine is a stand-in this story drops in: it reads its instructions on standard input and writes one known file. Nothing reaches the network, and no model is called.
    # Copy: task devsecops:code:agent:doctor
    Then the toolbox reports the AI tools this machine holds and the models each one gives
    # Chapter: The cycle that cannot be run out of order
    # Note: The cycle writes the step it really reached into tmp/agent/phase. Here that file does not exist yet: nothing has been done.
    # Note: So the step that writes the code refuses to start. It says what it read, what it was waiting for — review:red, the step where the test is written, its failure proven and that failure reviewed — and which command to run next.
    # Note: Nobody has to remember where the cycle stands. The file decides, and a step out of order is refused before it can do anything.
    # Copy: task devsecops:code:agent:green -- @greeting
    Then the step that writes the code refuses to start while no failure has been proven
    # Note: Same command as the picture before. This time tmp/agent/phase reads review:red, because the two steps before it have run: the test was written, its failure was proven against the report, and the review recorded ACCEPT.
    # Note: So the step starts. The tool writes the greeting the test was asking for, and the toolbox runs that test again to see for itself: "OK | 1 passed". The check that was failing four pictures ago passes.
    # Note: Every step of this was decided by something that returns an exit code. Nothing was taken on anyone's word, which is the whole point.
    # Copy: task devsecops:code:agent:green -- @greeting
    And the same step runs once the cycle has recorded the steps before it, and the test finally passes
