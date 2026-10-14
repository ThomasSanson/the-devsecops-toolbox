---
name: test
description: Run E2E tests with CodeceptJS and Playwright. Use when running tests, debugging test failures, or writing new tests. Includes visual regression testing.
---

# Test

## When to use this skill

- Running E2E tests
- Debugging test failures
- Writing new tests

## How to run tests

### Whole suite (deploys first)

```bash
task test
```

### Targeted test by tag

```bash
task test -- --grep "@my-tag"
```

### Fast TDD cycle (no rebuild)

```bash
task project:test:tdd
```

### E2E suite only (no guards)

```bash
task project:test:e2e
```

## Visual regression

See [`tests-integrity.md`](../../rules/tests-integrity.md) for complete rules.

## Page Object Pattern

Study these reference files to understand the correct patterns:

### Reference Patterns

| Reference        | Location                             |
|------------------|--------------------------------------|
| Page Objects     | `project/tests/e2e/pages/`           |
| Step definitions | `project/tests/e2e/support/steps/`   |
| Helpers          | `project/tests/e2e/support/helpers/` |

### ⛔ FORBIDDEN

- ❌ Inline logic in steps (use Page Objects)
- ❌ Hardcoded selectors (centralize in `this.selectors`)
- ❌ Hardcoded `I.wait(2)` (use `TIMEOUTS`)
- ❌ Screenshot without `assertVisualMatch()`
- ❌ Gherkin in wrong language (write in **en**)

## Decision tree

**Test failing?**
1. Check if environment is deployed (`task deploy`)
2. Check service logs with the project's log task (`task --list`)
3. Check test data state
4. Re-run targeted test (`task test -- --grep "@tag"`)

## Reference files

- `project/tests/e2e/codecept.conf.js` — Configuration
- `project/tests/e2e/features/` — Gherkin features
- `project/tests/README.md` — Capture styles, baselines and conventions
