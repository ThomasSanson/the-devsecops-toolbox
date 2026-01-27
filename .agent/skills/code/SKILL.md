---
name: code
description: Run linters and code quality checks. Use when checking code style, fixing lint errors, or before committing. Executes Mega-Linter via task code.
---

# Code Quality

## When to use this skill

- Running linters before commit
- Fixing code style issues
- Checking code complexity
- Validating YAML, Markdown, JavaScript syntax

## How to run

From repository root:

```bash
task code
```

This runs Mega-Linter with all configured linters.

## Common linter errors

| Linter   | Issue            | Fix                         |
|----------|------------------|-----------------------------|
| ESLint   | JavaScript style | Follow Airbnb/project rules |
| Prettier | Formatting       | Auto-fix with `--fix`       |
| YAML     | Syntax errors    | Check indentation           |
| Markdown | Documentation    | Follow MD rules             |

## Decision tree

**Lint error?**
1. Read the error message carefully
2. Check if auto-fix available (`--fix`)
3. If style rule, follow project conventions
4. If complexity, refactor the code
5. Re-run `task code` to verify

## Rules

- ❌ NEVER skip linting
- ❌ NEVER disable rules without justification
- ✅ ALWAYS run `task code` before commit
- ✅ Fix ALL errors, not just some
