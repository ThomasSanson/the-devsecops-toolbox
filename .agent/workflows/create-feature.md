---
description: Implement a new template feature using TDD with Gherkin tests
---

# Create Feature Workflow

This workflow guides you through implementing a new template feature using Test-Driven Development (TDD) with Gherkin/CodeceptJS tests in the unified e2e suite.

## Prerequisites

- Understand the feature requirements
- Identify the domain and feature name (existing domains: `01-install/`, `02-daily-work/`, `03-evolution/`)
- Have a clear picture of the expected Copier question(s) and template changes

## Test Architecture

Search for existing tests and steps to understand the project structure:
- **Feature files:** `project/tests/e2e/features/{domain}/{feature}.feature`
- **Step definitions:** `project/tests/e2e/support/steps/*.js`
- **Helpers:** `project/tests/e2e/support/helpers/*.js` (copierRender, textRender, gitlabApi, docker, …)
- **Visual baselines:** `project/tests/e2e/screenshots/base/` (tolerance: 0)

## Workflow Steps

### 1. Define the Feature (Gherkin)

Create a new feature file in `project/tests/e2e/features/{domain}/{feature}.feature`.

**Instruction:**
Read an existing feature file to understand the mandatory tags and step patterns.
For Copier rendering assertions, start from `features/03-evolution/matrix.feature`
(steps: `Given a project rendered from the working-branch template with answers "key=value"`).

**Mandatory Rules:**
- NO Background block.
- Tag every scenario with `@e2e` plus unique domain/feature tags: `@e2e-{feature}`.
- Add a pixel baseline for every stage whose rendering is deterministic
  (`the rendered configuration layout should visually match "..."`); fall back
  to content/log/REST assertions only for genuinely volatile content.

### 2. Add Step Definitions

Reuse the steps in `project/tests/e2e/support/steps/template-matrix.js` when possible.
If new steps are needed, create or extend a steps file under `project/tests/e2e/support/steps/`.

**IMPORTANT:** If creating a new file, add it to the `gherkin: { steps: [...] }` section in `project/tests/e2e/codecept.conf.js`.

### 3. Run Tests (Should Fail)

```bash
// turbo
task test -- --grep "@e2e-{feature}"
```

### 4. Implement Copier Configuration

Edit `copier.yml` to add questions.

**Instruction:**
See existing definitions in `copier.yml` for patterns (type, help, choices, default).

### 5. Create/Modify Jinja Templates

Update files in `.config/{domain}/`.

**Instruction:**
Explore `.config/` to see how Jinja conditions (`{% if %}`) and template naming conventions (e.g., `.jinja` suffix) are used.

### 6. Run Tests (Should Pass)

```bash
// turbo
task test -- --grep "@e2e-{feature}"
```

### 7. Global Verification

```bash
// turbo
task test
// turbo
task code
```

## Constraints Checklist

- [ ] TDD: Tests written before implementation
- [ ] Files in the correct domain folder under `features/`
- [ ] No Background block in feature files
- [ ] Scenarios tagged `@e2e` + unique `@e2e-{feature}` tag
- [ ] Steps are parameterized and reusable
- [ ] New steps file (if any) added to `codecept.conf.js`
- [ ] New visual baselines inspected by a human
- [ ] All linters pass (`task code`)
