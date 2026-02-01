---
description: Add functionality to an existing template feature
---

# Update Feature Workflow

This workflow guides you through adding new functionality to an **existing** template feature.

## Prerequisites

- Identify the existing feature/domain to extend
- Understand what functionality needs to be added
- Check existing tests to understand current behavior

## Workflow Steps

### 1. Review Existing Feature

Analyze the current implementation by reading files in:
- **Feature file:** `project/tests/features/{domain}/{feature}.feature`
- **Steps:** `project/tests/**/steps/{domain}.js`
- **Templates:** `.config/{domain}/`
- **Config:** `copier.yml`

### 2. Add or Update Tests (TDD)

Update the existing feature file or add a new one in the same domain.

**Instruction:**
Follow the existing Gherkin style in the feature file. Use the `@new-functionality` tag for development if needed.

### 3. Run Tests (Should Fail)

```bash
// turbo
task test -- --grep "@{domain}"
```

### 4. Implement Changes

#### Updating Logic
- Edit `copier.yml` for new questions.
- Update templates in `.config/{domain}/`.

**Instruction:**
Use the codebase as the source of truth for syntax and logic patterns.

### 5. Run Tests (Should Pass)

```bash
// turbo
task test -- --grep "@{domain}"
```

### 6. Global Verification

```bash
// turbo
task test
// turbo
task code
```

## Checklist

- [ ] New tests added for new functionality
- [ ] Implementation follows existing patterns in the codebase
- [ ] All tests pass (`task test`)
- [ ] All linters pass (`task code`)
