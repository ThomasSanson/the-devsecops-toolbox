---
description: List existing e2e domains and features
---

# Read Feature Workflow

Use this workflow to discover existing domains and features in the e2e suite.

## Workflow Steps

### 1. List Domains

Domains are the top-level categories of features.

```bash
ls project/tests/e2e/features/
```

### 2. List Features in a Domain

Each domain contains one or more `.feature` files. Domains are the three journey acts: `01-install`, `02-daily-work`, `03-evolution`.

```bash
ls project/tests/e2e/features/{domain}/
```

### 3. Summary of Features

You can use `grep` to quickly see the titles of all features:

```bash
grep -r "Feature:" project/tests/e2e/features/
```

### 4. Check Implementation

To see the implementation status or configuration for a domain:

- **Step Definitions:** `ls project/tests/e2e/support/steps/`
- **Helpers:** `ls project/tests/e2e/support/helpers/`
- **Visual baselines:** `ls project/tests/e2e/screenshots/base/`
- **Template Files:** `ls .config/{domain}/`
- **Copier Configuration:** `grep -A 10 "{domain}" copier.yml`
