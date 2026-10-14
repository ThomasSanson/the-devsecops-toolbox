---
name: tdd-step1-red
description: Write a failing test specification. The test MUST fail before any implementation.
---

# TDD Red Phase — Write Failing Test

**Goal:** Create a test that fails because the feature doesn't exist yet.

## Prerequisites

```bash
task deploy
```
Ensure services are running.

## Step 1: Create Feature File

Create it in `project/tests/e2e/features/{domain}/` (`01-install`, `02-daily-work` or `03-evolution`).

**Requirements:**
- **Language:** English
- **Tag:** Unique `@tag` for isolation
- **Format:** Feature / Scenario / Given / When / Then

## Step 2: Create Step Definitions (if needed)

Reuse or extend a steps file under `project/tests/e2e/support/steps/`. A new file goes in the `gherkin.steps` list of `project/tests/e2e/codecept.conf.js`.

- Use Page Object pattern
- Page Objects in `project/tests/e2e/pages/`

## Step 3: Run Test — MUST FAIL

```bash
task test -- --grep "@your-tag"
```

### ✅ Expected Outcomes (any of these = success)

- ❌ **Element not found** → Feature UI doesn't exist yet
- ❌ **Assertion failed** → Logic not implemented yet

An undefined step is not a RED: define it and run again.

### ⛔ FAILURE of this phase

- ✅ Test passes → **BUG!** Test is wrong or feature already exists

## Step 4: Prove the Failure Is Real

```bash
task devsecops:test:check:red-is-real -- @your-tag
```

It must pass. It reads the report the run left behind and accepts only a scenario that ran and failed. A run that died while loading its files recorded no scenario: that is a crash, not a RED.

## Checkpoint

**Before proceeding to implementation:**

1. Test file exists in correct location
2. Test runs (no syntax errors)
3. Test **FAILS** for the right reason
4. `red-is-real` accepts the failure

---

## Next Step

Once test fails correctly, proceed to implementation (GREEN phase).
