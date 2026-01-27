---
name: TDD Red Phase
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

**Choose the correct location:**

| Type                      | Location                                                       |
|---------------------------|----------------------------------------------------------------|
| Frontend/Backend (business) | `project/tests/application/features/{domain}/`                 |
| Infrastructure tool       | `project/tests/{tool}/features/` (ex: `portainer`, `superset`) |

**Requirements:**
- **Language:** French (`# language: fr`)
- **Tag:** Unique `@tag` for isolation
- **Format:** Fonctionnalité / Scénario / Etant donné / Quand / Alors

## Step 2: Create Step Definitions (if needed)

**Choose the correct location:**

| Type                      | Location                                               |
|---------------------------|--------------------------------------------------------|
| Frontend/Backend (business) | `project/tests/application/step_definitions/{domain}/` |
| Infrastructure tool       | `project/tests/{tool}/step_definitions/`               |

- Use Page Object pattern
- Page Objects in `./pages/` of the same test folder

## Step 3: Run Test — MUST FAIL

```bash
task test -- --grep "@your-tag"
```

### ✅ Expected Outcomes (any of these = success)

- ❌ **Step not implemented** → Create step definition
- ❌ **Element not found** → Feature UI doesn't exist yet
- ❌ **Assertion failed** → Logic not implemented yet
- ❌ **Timeout** → Page/component doesn't exist

### ⛔ FAILURE of this phase

- ✅ Test passes → **BUG!** Test is wrong or feature already exists

## Checkpoint

**Before proceeding to implementation:**

1. Test file exists in correct location
2. Test runs (no syntax errors)
3. Test **FAILS** for the right reason

---

## Next Step

Once test fails correctly, proceed to implementation (GREEN phase).
