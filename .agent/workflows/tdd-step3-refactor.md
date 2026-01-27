---
name: TDD Refactor Phase
description: Improve code quality without changing behavior. Test must still pass.
---

# TDD Refactor Phase — Clean Up

**Goal:** Improve code structure and quality without changing behavior.

## Prerequisites

- Test **PASSES** (GREEN phase completed)

## Step 1: Identify Improvements

Look for:

- Duplicate code → Extract to functions/methods
- Magic values → Extract to constants
- Long methods → Split into smaller ones
- Poor naming → Rename for clarity

## Step 2: Refactor Code

Apply improvements **one at a time**:

- Change structure, not behavior
- Keep test untouched
- Run test after each change

## Step 3: Run Test — MUST STILL PASS

```bash
task test -- --grep "@your-tag"
```

### ✅ Expected Outcome

- ✅ Test still passes
- Code is cleaner

### ⛔ If test fails

- Revert last change
- Refactor was too aggressive

## Step 4: Quality Check

```bash
task code
```

Fix any linter errors.

## Step 5: Full Test Suite

```bash
task test
```

Ensure no regressions.

## Checkpoint

**Refactor complete when:**

1. Test still passes
2. Code is cleaner
3. All linters pass
4. No regressions

---

## Cycle Complete

Return to RED phase for next feature.
