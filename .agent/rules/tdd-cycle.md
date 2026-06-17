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

| Step | Action                         | Command                      | Expected             |
|------|--------------------------------|------------------------------|----------------------|
| 1    | Write test (Gherkin, @tag)     | —                            | Feature file created |
| 2    | **RED** — Verify test fails    | `task test -- --grep "@tag"` | FAIL                 |
| 3    | Implement minimal code         | —                            | Code written         |
| 4    | **GREEN** — Verify test passes | `task test -- --grep "@tag"` | PASS                 |
| 5    | Refactor (DO NOT touch test)   | —                            | Code improved        |
| 6    | Verify after refactor          | `task test -- --grep "@tag"` | PASS                 |
| 7    | Quality check                  | `task code`                  | PASS                 |
| 8    | Full test suite                | `task test`                  | ALL PASS             |

## Checkpoints

- **STEP 2**: DO NOT PROCEED until test fails
- **STEP 4**: DO NOT PROCEED until test passes
- **STEP 6**: If test fails, revert refactoring

## ⛔ FORBIDDEN

- ❌ Writing code BEFORE the test
- ❌ Skipping any step
- ❌ Modifying the test to make it pass
- ❌ Stopping at planning without executing this cycle

**NOTE:** Planning is OK. But after planning, execute this cycle.
