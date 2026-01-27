---
description: Project code style conventions
alwaysApply: true
---

# Code Style

## JavaScript / Node.js

- ✅ Use CommonJS (`require` / `module.exports`)
- ❌ NEVER use ES Modules (`import` / `export`) in test files

## Scripts

- ✅ Externalize scripts in dedicated files (`project/{service}/scripts/`)
- ❌ NEVER inline scripts in Taskfile

## Language conventions

- ✅ Page Object methods in **French** (e.g., `naviguerVers`, `seConnecter`)
- ✅ Gherkin features in **French**
- ✅ Code variables/functions in **English**
- ✅ User-facing documentation in **French**

## Minimalism Principle

- ✅ Add **only what is explicitly requested**
- ✅ Follow existing style of similar files in the project
- ✅ Healthchecks are useful and recommended
- ❌ DO NOT add superfluous properties (e.g., `container_name` not required)
- ❌ DO NOT "improve" code beyond the initial request

## File locations

- Page Objects: `project/tests/application/pages/{domain}/`
- Features: `project/tests/application/features/{domain}/`
- Step definitions: `project/tests/application/step_definitions/`
