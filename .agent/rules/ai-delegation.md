---
trigger: always_on
description: The contract for work done by an AI — which command certifies each phase of the loop, what is never done, and how a model delegating to another checks the result
---

# Work done by an AI, and how it is checked

You may be reading this as the assistant a developer is talking to, or as a
cheaper model a bigger one just handed a task. Either way this page is the whole
contract, and you do not need to be told it again in the prompt.

**Nothing here asks you to trust anyone, including yourself.** Each phase of the
loop has one command that certifies it with an exit code. Run it. That is the
difference between "I think it works" and "it works".

## The loop, and the command that certifies each phase

| Phase       | What happens                                                            | The command that settles it  |
|-------------|-------------------------------------------------------------------------|------------------------------|
| **plan**    | read the issue; if the behaviour cannot be written as a test, ask first | — (judgement, not a command) |
| **code**    | the failing test FIRST, then the smallest code that satisfies it        | `task devsecops:code:verify` |
| **build**   | whatever this project builds                                            | `task build`                 |
| **test**    | the suite runs and passes                                               | `task devsecops:test:verify` |
| **release** | version, changelog, tag                                                 | a human's, not yours         |

And, before you say the work is done, whatever the phase:

```bash
task verify
```

One exit code for all of it: **nothing was switched off, the linter is clean,
the tests pass.** It runs the cheapest and most damning check first, so a cheat
is caught in a second rather than after twenty minutes of test suite.

## Inside the code phase: the order is not decoration

- **First**, write the test. It must fail.
- **Then** run it and read the failure. It has to fail on **its own check** —
  not because a file is missing, a module will not load, or the run died before
  reaching it. Those exit non-zero too, and they prove nothing.
- If your runner writes a JUnit report, that step is checkable:
  `task devsecops:test:check:red-is-real -- <tag>` accepts only a scenario that
  was recorded AND failed.
- **Only then** write the code. The smallest thing that turns the test green.

## ⛔ Four things that are never done here

- **Never switch a check off to get green.** No `@skip`, no `@wip`, no
  `.only(`, no `xScenario`, no raised `tolerance:`, no `allow_failure: true`.
  If a check caught something, fix what it caught.
- **Never silence a linter.** No `eslint-disable`, no `# noqa`, no `# nosec`,
  no `shellcheck disable` added to make an error go away. An error the linter
  reports is a thing to correct, not a thing to mute.
- **Never delete or weaken a test you did not write.** A test in the way is a
  conversation, not an obstacle.
- **Never claim a step is done without running its command.** Saying so before
  you have seen the exit code is the one mistake that cannot be fixed in the
  next commit, because it destroys the only thing anyone was relying on.

These four are read mechanically, so a rushed model cannot step over them:
`task verify` locally, and the `no-cheat` job on every merge request.

## If you are the orchestrator

You were asked to take an issue and hand the work to another assistant. Then:

- **Give it the issue and this page.** Nothing else is needed — the contract is
  here, and the executor reads it from the repository.
- **Do not judge the result yourself.** Run the phase's command and read the
  exit code. You and the executor share the same bias — to conclude — so the
  only opinion that is not yours is the one that returns 0 or 1.
- **When it refuses, hand the refusal back verbatim.** It names the file, the
  line and what that line does. An executor that never learns why it was
  rejected repeats the mistake, and you pay for the same turn twice.
- **Three refusals on the same step means the issue is wrong, not the
  executor.** Stop and re-read what you asked for. An acceptance criterion that
  cannot be tested cheaply will loop forever.

## If you are the executor

Do the work, run the command for the phase you are in, and report the exit code
you actually saw. If it refused, say what it said. A refusal handed back
honestly costs one turn; a refusal hidden costs the whole task.

## When switching a check off is genuinely right

It happens. Make it visible rather than quiet — add a trailer to the commit:

```text
No-cheat-exempt: <why switching this off is the honest thing to do>
```

Review reads the reason. That is the whole difference between a decision and a
shortcut.

## What this costs you

Nothing is imposed. A project that wants none of it runs none of it: these are
tasks, not hooks. What ships enabled is the single merge-request job that
refuses a switched-off check — because that one protects the repository from
everybody, including whoever forgot to run anything.
