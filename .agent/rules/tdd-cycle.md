---
trigger: always_on
description: Mandatory TDD cycle for any code change
---

# TDD Cycle

## When this applies — no rationalization allowed

The cycle triggers on ANY edit matching these patterns, regardless of motivation
(new feature, bugfix, CI incident, hotfix, refactor, "simple tweak", "ops work"):

The cycle does **NOT** trigger on:

- `project/**/docker-compose.yml`, `Dockerfile`, `entrypoint.sh` — infrastructure
- `project/Taskfile.yml`, `.gitlab-ci.yml` — orchestration
- `project/tests/**` — test code itself
- `.agent/**`, `CLAUDE.md`, `AGENTS.md`, `*.md` at root — meta/docs

The cycle **DOES** trigger on these — commonly (and wrongly) waved through as
"just config" or "just a tweak":

- `.config/**/*.sh` and any shell script (e.g. `install.sh`) — this is code
- `.config/**` that encodes BEHAVIOUR or an INVARIANT — e.g. Renovate
  `customManagers`, version pins, a tool's `version` file alignment. If the
  change makes the project *do* something different (or guarantees something),
  it needs a failing test first.

If you cannot name the test that would fail without your change, you are not
allowed to make the change yet — write that test.

**Anti-pattern explicitly forbidden**: *"CI is red → patch `src/` fast, write
the test afterwards."* If CI pressure pushes you to skip the cycle, stop and
write the test first — the RED step is often the cleanest local reproduction
of the CI failure, and the GREEN step proves you actually fixed the observed
bug rather than a nearby symptom.

**Anti-pattern explicitly forbidden — "the validator is my test"**: a syntax /
schema / lint / `*-config-validator` check proves the file is WELL-FORMED, not
that it does what you intended. It is NOT the RED→GREEN test. If you add a
Renovate manager, a version pin, a config rule, etc., write a test that fails
when the *behaviour/invariant* is absent and passes when it is present — then
run the validator on top.

## ⛔ MANDATORY FOR ANY CODE CHANGE

For ANY feature, bug fix, or modification, execute these steps IN ORDER:

| Step | Action                         | Command                                         | Expected             |
|------|--------------------------------|-------------------------------------------------|----------------------|
| 1    | Write test (Gherkin, @tag)     | —                                               | Feature file created |
| 2    | **RED** — Verify test fails    | `task test -- --grep "@tag"`                    | FAIL                 |
| 3    | **Prove the failure is real**  | `task devsecops:test:check:red-is-real -- @tag` | PASS                 |
| 4    | Implement minimal code         | —                                               | Code written         |
| 5    | **GREEN** — Verify test passes | `task test -- --grep "@tag"`                    | PASS                 |
| 6    | Refactor (DO NOT touch test)   | —                                               | Code improved        |
| 7    | Verify after refactor          | `task test -- --grep "@tag"`                    | PASS                 |
| 8    | Quality check                  | `task code`                                     | PASS                 |
| 9    | Full test suite                | `task test`                                     | ALL PASS             |

## Checkpoints

- **STEP 2**: DO NOT PROCEED until test fails
- **STEP 3**: DO NOT PROCEED until the failure is proven. A run that dies while
  loading its files exits non-zero and records no scenario at all — a crash, not
  a failure. Step 3 reads the report the run left behind and refuses that.
- **STEP 5**: DO NOT PROCEED until test passes
- **STEP 7**: If test fails, revert refactoring

## ⛔ FORBIDDEN

- ❌ Writing code BEFORE the test
- ❌ Skipping any step
- ❌ Modifying the test to make it pass
- ❌ Switching a check off to make the pipeline green (`@skip`, `.only(`, a
  non-zero `tolerance:`, `allow_failure: true`). The `no-cheat` merge-request job
  reads the lines a change adds and refuses them; the only waiver is a visible
  `No-cheat-exempt: <why>` commit trailer.
- ❌ Stopping at planning without executing this cycle

**NOTE:** Planning is OK. But after planning, execute this cycle.
