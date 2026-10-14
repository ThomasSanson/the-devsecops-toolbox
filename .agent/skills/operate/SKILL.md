---
name: operate
description: Manage infrastructure operations like stopping services, accessing containers, backups, and maintenance. Use for operational tasks outside the dev cycle.
---

# Operate

## When to use this skill

- Stopping services
- Accessing container shells
- Database backups
- Database operations
- Environment initialization

## How to run

```bash
task operate
```

Operate tasks belong to the project: stopping services, shell access, backups and repairs.
`task --list` shows the ones `project/Taskfile.yml` defines. If one is missing, add it there as `project:operate:{service}:{action}`.

## Decision tree

**Need fresh start?**
1. Stop the services with the project's own operate task
2. `task deploy` — Restart clean

If a deploy fails, read the logs and fix the cause. Never run anything that deletes containers, volumes or data without the person's explicit go-ahead.

**Database issues?**
1. Back up first
2. Check migrations logs
3. Repair if needed
