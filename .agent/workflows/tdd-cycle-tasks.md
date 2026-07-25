---
name: The test-first cycle, as tasks
description: Run RED → GREEN → REFACTOR one task at a time, each ending on a verdict nobody can argue with — by hand, or handed to an AI assistant
---

# The test-first cycle, driven by tasks

The cycle has always been the same: write the test, watch it fail, write the
code, clean up. What changed is who checks it. The sequence used to live in
prose addressed to whoever was driving it — a developer in a hurry, or an AI
assistant that wants above all to conclude. Prose cannot refuse anything.

Here each phase is a task. The phase really reached is written on disk, so a
phase refuses to start when the recorded phase is not the one before it: the
sequence cannot be skipped, and nothing has to be remembered.

**Nothing here is reserved for an AI assistant.** Run a phase with none declared
and it says so, then checks the work *you* just did against the same gates. An
assistant is an option that changes who types, and nothing else.

**The one rule the machinery cannot enforce, and the reason for all of it:
whoever drives the cycle never judges what an exit code can judge.**

## The sequence

| Phase                                   | What is done (by you, or by an assistant) | What decides                                                                                           |
|-----------------------------------------|-------------------------------------------|--------------------------------------------------------------------------------------------------------|
| `task devsecops:test:tdd:red -- @tag`   | writes the failing test                   | the tree really changed, the change touches **test files only**, `check:red-is-real`, `check:no-cheat` |
| `task devsecops:test:tdd:review:red`    | argues against its own test               | a written `VERDICT: ACCEPT`, kept under `tmp/agent/`                                                   |
| `task devsecops:test:tdd:green -- @tag` | writes the smallest code                  | the tree really changed, the tests now pass, `check:no-cheat`                                          |
| `task devsecops:test:tdd:review:green`  | hunts over-engineering                    | a written `VERDICT: ACCEPT`                                                                            |
| `task devsecops:test:tdd:refactor`      | improves without changing behaviour       | the tests still pass, `check:no-cheat`                                                                 |

`task devsecops:test:tdd:reset` forgets the recorded phase — the only way back
to the start, so an abandoned cycle is abandoned deliberately.

The issue, the branch and the merge request stay a human's business, and the
commits stay yours: no phase commits or pushes anything.

## The two gates behind it

- **`task devsecops:test:check:red-is-real -- @tag`** reads the JUnit report the
  test run leaves behind. The scenario must be **recorded** and must have
  **failed**. A run that dies while loading its files exits non-zero and records
  nothing — that is a crash, not a proof, and it is refused. This is the step the
  whole method rests on, and it was the one taken on trust.
- **`task devsecops:test:check:no-cheat`** reads the lines a change ADDS and
  refuses the ones that switch a check off: a skipped or exclusive scenario, a
  raised visual tolerance, `allow_failure: true`, a linter silenced inside the
  tests. It also runs as its own merge-request job, so what passes locally is
  what CI reads.

Both are proven visually, by stories that run the real gates:
`project/tests/e2e/features/02-daily-work/tdd-cycle.feature` and
`project/tests/e2e/features/03-evolution/test-discipline.feature`.

## Handing a phase to an assistant (optional)

The framework ships no AI tool and names none: tools and model names move faster
than a framework can follow. A machine declares the ones it holds, one small
file each, under `.config/devsecops/agents.d/` — see the README there. Declaring
none is a perfectly good answer; the phases then check what you write.

```bash
task devsecops:test:tdd:doctor
```

lists every drop-in, whether its binary is really on this machine, and the
models each tool reports **when asked** (never a list held here).

The contract is one line: the command reads the prompt on standard input, edits
the working tree, and **a run that leaves `git diff` empty is a failure, not a
success**. `TASK_AGENT_EXEC_CMD` overrides everything, for CI or a one-off run.

## What the prompts are made of

Nothing is copied into the harness. Each phase reads the versioned rules
themselves from the working tree — `.agent/workflows/tdd-step1-red.md`,
`.agent/rules/tests-integrity.md` and the reference story that rule names — so
the rule and its exemplar stay the authority, and editing them changes what the
executor is told.

## What this does not do yet

Opening the issue, the branch and the merge request, waiting on the pipeline and
walking a list of issues unattended are deliberately not here. The cycle above is
the part that can be checked mechanically today; the rest is judgement, and
judgement is still a human's.
