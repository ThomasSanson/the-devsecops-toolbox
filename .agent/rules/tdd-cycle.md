---
trigger: always_on
description: Mandatory TDD cycle for any code change
---

# TDD Cycle

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
