---
trigger: always_on
description: Test organization - separation between application and infrastructure
alwaysApply: true
---

# Tests Structure

## ⛔ MANDATORY SEPARATION

Tests MUST be organized by **type**, not mixed together:

```text
project/tests/
├── application/           # Main application business tests
│   ├── features/          # Gherkin by business domain
│   ├── pages/             # Page Objects by domain
│   ├── step_definitions/  # Steps by domain
│   └── ...
├── portainer/             # Portainer infrastructure tests (ISOLATED)
│   ├── features/
│   ├── pages/
│   ├── step_definitions/
│   └── codecept.conf.js
├── superset/              # Superset infrastructure tests (ISOLATED)
│   └── ...
└── {other-infra}/         # Each infra has its own folder
```

## ✅ CORRECT placement

| Test type                                 | Folder                |
|-------------------------------------------|-----------------------|
| Business feature (login, inventory, etc.) | `tests/application/`  |
| Infrastructure (Portainer, Mailpit, etc.) | `tests/{infra-name}/` |
| Superset (dashboards, embedding)          | `tests/superset/`     |

## ⛔ FORBIDDEN

- ❌ NEVER place infrastructure tests in `tests/application/`
- ❌ NEVER mix Portainer/Mailpit/Superset tests with business tests
- ❌ NEVER create `tests/application/features/portainer/`
- ❌ NEVER create `tests/application/step_definitions/portainer/`

## Each infrastructure test folder MUST contain

1. `codecept.conf.js` — Dedicated configuration
2. `features/` — Gherkin in **en**
3. `pages/` — Page Objects with methods in **en**
4. `step_definitions/` — Steps using Page Objects
