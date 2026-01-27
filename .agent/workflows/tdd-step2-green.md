---
name: TDD Green Phase
description: Implement minimal code to make the failing test pass. Nothing more.
---

# TDD Green Phase — Make Test Pass

**Goal:** Write the minimum code to make the test pass.

## Prerequisites

- Test exists and **FAILS** (RED phase completed)
- You know exactly what the test expects

## Step 1: Implement Minimal Code

Write **only** what's needed to pass the test:

- No extra features
- No premature optimization
- No "while I'm here" additions

## Step 2: Run Test — MUST PASS

```bash
task test -- --grep "@your-tag"
```

### ✅ Expected Outcome

- ✅ Test passes

### ⛔ If test still fails

- Fix the **code**, not the test
- Re-run until green

## Checkpoint

**Before proceeding to refactor:**

1. Test passes
2. Implementation is minimal
3. No other tests broken

---

## Next Step

Once test passes, proceed to REFACTOR phase (optional but recommended).
