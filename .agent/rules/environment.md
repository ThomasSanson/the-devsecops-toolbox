---
description: Environment files at repository root only
alwaysApply: true
---

# Environment Files

## Location: REPOSITORY ROOT ONLY

Environment files MUST be at repository root, not in subdirectories.

## ✅ ALLOWED

- `.env.dist` at root → Default values for all services (versioned) - **NO SECRETS**
- `.env.dev` at root → Local/dev overrides (versioned) - **SECRETS ALLOWED (for dev)**

## ⛔ FORBIDDEN

- ❌ NEVER create `.env` file (not versioned)
- ❌ NEVER create `.env.dist` in `project/` or any subdirectory
- ❌ NEVER create `.env.dev` in `project/` or any subdirectory
- ❌ NEVER hardcode secrets in code
- ❌ NEVER modify `.config/` contents

## Environment Layering

Taskfile loads dotenv files by priority (first wins):

```yaml
dotenv: [".env", ".env.dev", ".env.dist"]
```

| File        | Versioned    | Secrets        | Purpose                                   |
|-------------|--------------|----------------|-------------------------------------------|
| `.env`      | ❌ gitignored | ✅ real secrets | Production/staging overrides              |
| `.env.dev`  | ✅ versioned  | ⚠️ dev only    | Development defaults (safe for local dev) |
| `.env.dist` | ✅ versioned  | ❌ never        | Base defaults for all environments        |

### Per environment

- **Development**: `.env.dev` + `.env.dist` — works out of the box, no manual setup
- **Production/Staging**: delete `.env.dev`, create `.env` with real values + `.env.dist`

### AI agents

- ❌ NEVER create or modify `.env` — reserved for production deployments
- ✅ Use `.env.dist` for defaults and `.env.dev` for dev overrides

## Adding new variables

1. Add default value in `.env.dist` at root
2. Add dev/local override in `.env.dev` at root if needed
3. Reference in Taskfile via `vars:` section
