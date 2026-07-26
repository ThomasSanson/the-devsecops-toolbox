---
trigger: always_on
description: Handing work to an assistant — the four rules that hold whoever writes the code, and the one command that settles whether it is done
---

# Work handed to an assistant

This project is worked on by people and by AI assistants, and increasingly by a
capable assistant that hands a task to a cheaper one. That is fine. What is not
fine is taking the report at the end on trust.

**These rules bind whoever writes the code. The one who delegates checks them —
by running the command below, not by reading a summary.**

## ⛔ The four things that are never done here

- **Never switch a check off to get green.** No `@skip`, no `@wip`, no
  `.only(`, no `xScenario`, no raised `tolerance:`, no `allow_failure: true`.
  If a check caught something, fix what it caught.
- **Never silence a linter.** No `eslint-disable`, no `# noqa`, no `# nosec`,
  no `shellcheck disable` added to make an error go away. An error the linter
  reports is a thing to correct, not a thing to mute.
- **Never delete or weaken a test you did not write.** A test that is in the
  way is a conversation, not an obstacle.
- **Never write the code before the test.** Write the test, run it, and see it
  fail for the reason you expect — not because a file is missing or a module
  will not load. A test that was never seen failing proves nothing about the
  code written after it.

## ✅ The one sentence that means "done"

```bash
task verify
```

It answers with a single exit code: nothing was switched off, the linter is
clean, the tests pass. **You are not done until it exits 0, and saying so
before you have run it is the one unrecoverable mistake** — everything else can
be fixed in the next commit.

## For whoever delegates

- Hand these rules over with the task. They are short on purpose.
- When the work comes back, **run `task verify` yourself**. Both of you share
  the same bias — to conclude — so the exit code is the only opinion that is not
  yours.
- If it refuses, hand the refusal back verbatim. It names the file, the line and
  what the line does. An assistant that never learns why it was rejected repeats
  the mistake.

## When switching a check off is genuinely right

It happens. Make it visible rather than quiet: add a trailer to the commit.

```text
No-cheat-exempt: <why switching this off is the honest thing to do>
```

Review reads the reason. That is the whole difference between a decision and a
shortcut.

## What is checked, and where

- **`task verify`** — before you commit: nothing switched off, linter clean,
  tests pass. One exit code.
- **the `no-cheat` CI job** — on every merge request, whatever anyone ran
  locally.
- **`task devsecops:test:check:red-is-real -- <tag>`** — that the failure you
  are claiming is a real one: the run reached the check, and the check is what
  failed. Optional, and it needs a JUnit report from your test runner; the two
  above need nothing.
