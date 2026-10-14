---
trigger: always_on
description: Use Task commands only from repository root
---

# Task Commands Only

## ⛔ MANDATORY

- ✅ Build, lint, test and deploy go through `task` from the repository root. Reading files and read-only git commands do not.
- ✅ ALWAYS run commands from repository root

## ⛔ FORBIDDEN

- ❌ NEVER use `docker compose` directly
- ❌ NEVER use `docker compose up`, `docker compose down`, `docker compose exec`
- ❌ NEVER use `npm run` or `npx` outside task
- ❌ NEVER `cd` into subdirectories to run commands

## Examples

```bash
# ✅ CORRECT — DevSecOps phases
task deploy                                      # Deploy all services
task build                                       # Build all images
task test                                        # Run all tests
task code                                        # Quality checks (linters, format)
task test:tdd                                    # TDD mode (no rebuild)
task --list                                      # List the tasks this project defines

# ❌ FORBIDDEN
docker compose up -d
docker compose exec backend bash
cd project && npm run test
```

## Missing tasks

If a command has no task, create one in `project/Taskfile.yml` following DevSecOps phases.
