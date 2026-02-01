---
description: Delete a template feature and its related files
---

# Delete Feature Workflow

This workflow guides you through the safe removal of a feature from the template.

## Workflow Steps

### 1. Identify Components

Identify all files related to the feature:

- **Tests:** `project/tests/features/{domain}/{feature}.feature`
- **Step Definitions:** `project/tests/**/steps/{domain}.js` (Note: multiple features might share one domain file)
- **Templates:** `.config/{domain}/`
- **Configuration:** `copier.yml`

### 2. Remove Tests

Delete the feature file:

```bash
rm project/tests/features/{domain}/{feature}.feature
```

If the domain folder is now empty, remove it:

```bash
rmdir project/tests/features/{domain}/
```

### 3. Clean up Step Definitions

If the domain steps file `project/tests/**/steps/{domain}.js` is no longer used by any other feature:

1. Remove it: `rm project/tests/**/steps/{domain}.js`
2. Remove the entry from `project/tests/codecept.conf.js`.

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
