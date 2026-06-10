---
description: Delete a template feature and its related files
---

# Delete Feature Workflow

This workflow guides you through the safe removal of a feature from the template.

## Workflow Steps

### 1. Identify Components

Identify all files related to the feature:

- **Tests:** `project/tests/e2e/features/{domain}/{feature}.feature`
- **Step Definitions:** `project/tests/e2e/support/steps/*.js` (Note: multiple features might share one steps file)
- **Visual baselines:** `project/tests/e2e/screenshots/base/` (remove the ones owned by the feature)
- **Templates:** `.config/{domain}/`
- **Configuration:** `copier.yml`

### 2. Remove Tests

Delete the feature file:

```bash
rm project/tests/e2e/features/{domain}/{feature}.feature
```

If the domain folder is now empty, remove it:

```bash
rmdir project/tests/e2e/features/{domain}/
```

Remove the feature's visual baselines (and only those).

### 3. Clean up Step Definitions

If a steps file under `project/tests/e2e/support/steps/` is no longer used by any other feature:

1. Remove it: `rm project/tests/e2e/support/steps/{name}.js`
2. Remove the entry from `project/tests/e2e/codecept.conf.js`.

### 4. Remove Template Files

Remove the configuration directory for the domain if it's no longer needed:

```bash
rm -rf .config/{domain}/
```

### 5. Update Copier Configuration

Remove the relevant questions and logic from `copier.yml`.

### 6. Verify

Run the full test suite to ensure no regressions:

```bash
// turbo
task test
```

### 7. Lint

Run linters to ensure no orphan references or config issues:

```bash
// turbo
task code
```
