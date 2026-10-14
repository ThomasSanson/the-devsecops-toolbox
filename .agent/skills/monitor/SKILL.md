---
name: monitor
description: Monitor services, check logs, and debug issues. Use when investigating failures, checking service health, or debugging.
---

# Monitor

## When to use this skill

- Investigating service failures
- Checking container logs
- Debugging issues

## View logs

Use the project's own log tasks: `task --list` shows them. `task monitor` runs `project:monitor` from `project/Taskfile.yml`, which shows no logs until the project fills it.

## Decision tree

**Service not responding?**
1. Check logs with the project's log task (`task --list`)
2. Check dependencies (DB, Redis, etc.)
3. Read `.env.dev` for ports and credentials, then open the service in a browser
