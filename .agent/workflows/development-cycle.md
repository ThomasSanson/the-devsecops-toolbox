---
name: Development Cycle
description: Mandatory TDD workflow for any code change. Follow steps IN ORDER. No shortcuts.
---

# Development Cycle Workflow

**⛔ READ rules/tdd-cycle.md FIRST — IT IS MANDATORY**

## Pre-flight checkpoint — ask yourself BEFORE any Edit/Write tool call

> *"Is the file I'm about to edit under `project/`
> or another path listed in the 'When this applies' section of
> `rules/tdd-cycle.md`?"*

- **YES** → you are editing code. Stop. Start at STEP 2 (write the test first).
  No exceptions, even under CI-incident pressure.
- **NO** → the file is infra/config/meta/test code; proceed directly.

This checkpoint exists because in practice the cycle is skipped not by defying
the rule, but by mentally reclassifying the change ("it's just ops",
"it's a quick hotfix"). Running the checkpoint kills the reclassification.

## Execution Order

You MUST execute these steps sequentially. Do NOT skip steps. When asked to implement, do not stop at a plan. When asked a question or for an analysis, answer it and change nothing.

### STEP 1: DEPLOY
```bash
task deploy
```
Wait for all services to be healthy.

### STEP 2: WRITE TEST SPECIFICATION

Create the feature in `project/tests/e2e/features/{domain}/` (`01-install`, `02-daily-work` or `03-evolution`).

**Requirements:**
- Language: **en** (`# language: en`)
- Include unique **@tag**

### STEP 3: RUN TEST — MUST FAIL (RED)
```bash
task test -- --grep "@your-tag"
```
**CHECKPOINT:** ❌ Test MUST fail. If it passes, fix the test.

Then prove the failure is real:

```bash
task devsecops:test:check:red-is-real -- @your-tag
```

It must pass. A run that died while loading its files recorded no scenario: that is a crash, not a RED.

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
// turbo
```bash
task devsecops:code:verify
```
**CHECKPOINT:** ✅ All linters pass. Fix any errors following the [code skill](../skills/code/SKILL.md).

### STEP 9: FULL TEST SUITE
// turbo
```bash
task devsecops:test:verify
```
**CHECKPOINT:** ✅ ALL tests pass. No regressions.

---

## ⛔ FORBIDDEN

See `rules/task-commands.md` and `rules/tdd-cycle.md` for complete rules.

- ❌ Writing code before the test
- ❌ Skipping any step
- ❌ Stopping at a plan when asked to implement
- ❌ Using `docker compose` directly
