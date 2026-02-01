---
description: List existing template domains and features
---

# Read Feature Workflow

Use this workflow to discover existing domains and features in the template.

## Workflow Steps

### 1. List Domains

Domains are the top-level categories of features.

```bash
ls project/tests/features/
```

### 2. List Features in a Domain

Each domain contains one or more `.feature` files.

```bash
ls project/tests/features/{domain}/
```

### 3. Summary of Features

You can use `grep` to quickly see the titles of all features:

```bash
grep -r "Feature:" project/tests/features/
```

### 4. Check Implementation

To see the implementation status or configuration for a domain:

- **Step Definitions:** `cat project/tests/**/steps/{domain}.js`
- **Template Files:** `ls .config/{domain}/`
- **Copier Configuration:** `grep -A 10 "{domain}" copier.yml`
