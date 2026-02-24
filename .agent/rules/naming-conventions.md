---
trigger: always_on
description: Naming conventions for Taskfile tasks and environment variables
---

# Naming Conventions

## Taskfile Tasks

### ⛔ MANDATORY

- ✅ All project tasks MUST follow the DevSecOps phase pattern: `project:{phase}:{service}:{action}`
- ✅ `{phase}` MUST be one of: `plan`, `code`, `build`, `test`, `release`, `deploy`, `operate`, `monitor`, `feedback`
- ✅ `{service}` identifies the component (e.g., `eleventy`, `scalingo`)
- ✅ `{action}` (optional) specifies the sub-operation (e.g., `env`, `env-set`, `info`)

### ⛔ FORBIDDEN

- ❌ NEVER create tasks like `project:{service}:{action}` — the phase MUST come before the service
- ❌ NEVER create tasks outside the DevSecOps phases

### Phase Mapping Guide

| Phase      | Purpose                              | Examples                                           |
|------------|--------------------------------------|----------------------------------------------------|
| `plan`     | Planning, migrations check           | `project:plan:db:migrations`                       |
| `code`     | Linters, formatters, static analysis | `project:code:eleventy:lint`                        |
| `build`    | Install deps, compile, package       | `project:build:eleventy`                            |
| `test`     | Unit, integration, E2E tests         | `project:test:application`, `project:test:tdd`      |
| `release`  | Tag, version, changelog              | `project:release:bump`                              |
| `deploy`   | Deploy to env, local dev server      | `project:deploy:eleventy`, `project:deploy:scalingo`|
| `operate`  | Env vars, backups, scaling, SSH      | `project:operate:scalingo:env`                      |
| `monitor`  | Logs, health checks, metrics         | `project:monitor:scalingo`, `project:monitor:scalingo:info` |
| `feedback` | Feedback metrics, reports            | `project:feedback:renovate`                         |

## Environment Variables

### ⛔ MANDATORY

- ✅ All Taskfile configuration variables MUST be prefixed with `TASK_`
- ✅ Service-specific variables follow: `TASK_{SERVICE}_{SETTING}` (e.g., `TASK_SCALINGO_APP`)
- ✅ Default values go in `.env.dist` (no secrets)
- ✅ Dev overrides go in `.env.dev`
