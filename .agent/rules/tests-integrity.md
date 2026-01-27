---
description: Test integrity - never cheat
alwaysApply: true
---

# Tests Integrity

## ⛔ NO CHEATING

- ❌ NEVER modify a test to hide a failure
- ❌ NEVER modify code AND test simultaneously to bypass validation
- ❌ NEVER delete or weaken existing tests
- ❌ NEVER skip tests

## ✅ CORRECT BEHAVIOR

- ✅ If test fails → fix the **code**, not the test
- ✅ If test is obsolete → discuss with team before removing
- ✅ Include visual regression test for each UI feature

## Visual Regression

Every UI test MUST include visual regression testing.

### ✅ CORRECT Pattern

**Reference:** See existing Page Objects in `project/tests/application/pages/` for the correct pattern:
1. Wait for stability (loader inactive)
2. Wait for key element visible with `TIMEOUTS.STABLE`
3. `I.saveScreenshot()` + `I.assertVisualMatch()`

### ⛔ FORBIDDEN

- ❌ Inline screenshot in steps (without Page Object)
- ❌ `I.saveScreenshot()` without `I.assertVisualMatch()`
- ❌ Hardcoded `I.wait(2)` (use `TIMEOUTS`)

### Reference files

- **Page Objects:** `project/tests/application/pages/{domain}/`
- **Config:** `project/tests/application/config/`
- **Base screenshots:** `project/tests/{context}/screenshots/base/`
- **Diff screenshots:** `project/tests/{context}/screenshots/diff/`
