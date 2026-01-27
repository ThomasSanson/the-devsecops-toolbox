---
name: Development Cycle
description: Mandatory TDD workflow for any code change. Follow steps IN ORDER. No shortcuts.
---

# Development Cycle Workflow

**⛔ READ rules/tdd-cycle.md FIRST — IT IS MANDATORY**

## Execution Order

You MUST execute these steps sequentially. Do NOT skip steps. Do NOT generate plans instead of executing.

### STEP 1: DEPLOY
```bash
task deploy
```
Wait for all services to be healthy.

### STEP 2: WRITE TEST SPECIFICATION

**Choose the correct location:**

| Type                      | Location                                                       |
|---------------------------|----------------------------------------------------------------|
| Frontend/Backend (business) | `project/tests/application/features/{domain}/`                 |
| Infrastructure tool       | `project/tests/{tool}/features/` (ex: `portainer`, `superset`) |

**Requirements:**
- Language: **French** (`# language: fr`)
- Include unique **@tag**

### STEP 3: RUN TEST — MUST FAIL (RED)
```bash
task test -- --grep "@your-tag"
```
**CHECKPOINT:** ❌ Test MUST fail. If it passes, fix the test.

### STEP 4: IMPLEMENT CODE
Write minimal code to pass the test. Nothing more.

### STEP 5: RUN TEST — MUST PASS (GREEN)
```bash
task test -- --grep "@your-tag"
```
**CHECKPOINT:** ✅ Test MUST pass. If it fails, fix the code (NOT the test).

### STEP 6: REFACTOR CODE
Improve code without changing behavior. Do NOT touch the test.

### STEP 7: RUN TEST — MUST STILL PASS
```bash
task test -- --grep "@your-tag"
```
**CHECKPOINT:** ✅ Test MUST still pass.

### STEP 8: QUALITY CHECK
```bash
task code
```
**CHECKPOINT:** ✅ All linters pass. Fix any errors.

### STEP 9: FULL TEST SUITE
```bash
task test
```
**CHECKPOINT:** ✅ ALL tests pass. No regressions.

---

## ⛔ FORBIDDEN

See `rules/task-commands.md` and `rules/tdd-cycle.md` for complete rules.

- ❌ Writing code before the test
- ❌ Skipping any step
- ❌ Stopping at planning without executing this cycle
- ❌ Using `docker compose` directly

**NOTE:** Planning is OK. But after planning, execute this workflow.
