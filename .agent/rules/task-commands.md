---
trigger: always_on
description: Use Task commands only from repository root
---

# Task Commands Only

## ⛔ MANDATORY

- ✅ ALWAYS use `task` from repository root
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

# Operate
task project:operate:ssh:{service}               # SSH into container
task project:operate:db:{service}                # Access DB CLI

# Monitor
task project:monitor:{service}                   # Logs specific service
task project:monitor:all                         # Logs all services

# Testing
task test                                        # Run all tests
task test:tdd                                    # TDD mode (watch)
task project:test:application                    # All application tests
task project:test:application -- --grep "@tag"   # Filter by tag
task project:test:application -- --steps         # Show step definitions
task project:test:application -- --verbose       # Verbose output
task project:test:application -- --grep "@tag" --steps  # Combined options

# ❌ FORBIDDEN
docker compose up -d
docker compose exec backend bash
cd project && npm run test
```

## If a task is missing

Create it in `project/Taskfile.yml` following DevSecOps phases.
