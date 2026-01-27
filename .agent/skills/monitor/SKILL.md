---
name: monitor
description: Monitor services, check logs, run diagnostics, and debug issues. Use when investigating failures, checking service health, or debugging.
---

# Monitor

## When to use this skill

- Investigating service failures
- Checking container logs
- Running diagnostics
- Debugging issues

## View logs

```bash
task project:monitor:{service}
```

Available services: Check `project/docker-compose.yml` for the list.

## Diagnostics

| Need                   | Command                                    |
|------------------------|--------------------------------------------|
| Full diagnostic        | `task project:operate:diagnostique:full`   |
| Full diagnostic report | `task project:monitor:diagnostic-complet`  |
| Remote diagnostic      | `task project:operate:diagnostique:remote` |

## Decision tree

**Service not responding?**
1. Check logs: `task project:monitor:{service}`
2. Check if container running: `docker ps`
3. Run diagnostic: `task project:operate:diagnostique:full`
4. Check dependencies (DB, Redis, etc.)

## Browser debugging

Use `browser_preview` to:
- Navigate application and verify UI
- Check DevTools network tab
- Verify API responses

Read `.env.dev` for ports and credentials.
