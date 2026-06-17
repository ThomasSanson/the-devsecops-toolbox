---
trigger: always_on
description: Test integrity — never cheat; a visual-regression baseline must be REAL captured output (via task), prove its setup, and cover both halves
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

Every test that proves something observable MUST include visual regression
(`assertVisualMatch` / `assertTextVisualMatch`) at tolerance **0**.

### A baseline must be REAL output — never composed

- ✅ Render the genuine artifact: run the REAL entrypoint (`task <thing>`, never the
  underlying tool by hand) and capture its output **verbatim**; for files/diffs show the
  real `cat` / `git diff`.
- ❌ NEVER hand-compose a baseline — no prose, no reformatted summary, no cherry-picking
  the "important" lines. If a user running the command would not see exactly that text,
  it is wrong.
- ✅ Mask ONLY truly volatile fields (durations, timestamps, per-run paths, the toolbox
  version). Prove determinism by running the assertion strict **twice** — a fresh volatile
  value each run, so the mask must absorb it.
- ✅ Keep the real terminal colours (force them through the pipe; do not strip ANSI to grey).

### Prove the SETUP, not just the result

An image is worth a thousand words: show the precondition you established (the file you
created, the `git diff` of what you changed) AND THEN the result. A test that only captures
the final state cannot prove its own setup.

### A discriminating proof needs BOTH halves

To prove "X is handled but Y is not", show BOTH — a positive case and a negative case (a
symmetric pair). A lone "nothing happened" baseline is ambiguous (broken vs intentionally
ignored). Keep the meaningful check programmatic (throw on violation); the visual is the
proof, not the test.

### Mechanics

1. Wait for stability (loader inactive; key element visible with `TIMEOUTS.STABLE`).
2. Capture via a Page Object: `I.saveScreenshot()` + `I.assertVisualMatch()`.

- ❌ Inline screenshot without a Page Object
- ❌ `I.saveScreenshot()` without `I.assertVisualMatch()`
- ❌ Hardcoded `I.wait(2)` (use `TIMEOUTS`)

### When a visual test fails — the only honest fixes

- Content differs → fix the **code** so the output is correct.
- Rendering differs (font / DPI / sub-pixel) → fix the deterministic launch args; do NOT
  raise tolerance, lower threshold, or skip the assertion.
- Legitimate evolution (e.g. a version bump) → regenerate the baseline in the SAME
  environment, and only after you understand exactly why it changed.

### Reference — the framework's own e2e suite (mirror this pattern in your tests)

- **Page Objects:** `project/tests/e2e/pages/`
- **Shared helpers (text/page render, masking):** `project/tests/e2e/support/helpers/`
- **Base screenshots:** `project/tests/e2e/screenshots/base/`
- **Conventions & how-to:** `project/tests/README.md`
