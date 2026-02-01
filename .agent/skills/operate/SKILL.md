---
name: operate
description: Manage infrastructure operations like stopping services, accessing containers, backups, and maintenance. Use for operational tasks outside the dev cycle.
---

# Operate

## When to use this skill

- Stopping or destroying services
- Accessing container shells
- Database backups
- Database operations
- Environment initialization

## Service lifecycle

| Action               | Command                          |
|----------------------|----------------------------------|
| Stop (keep volumes)  | `task project:operate:down`      |
| Destroy (delete all) | `task project:operate:destroy`   |
| Prune Docker         | `task project:operate:prune:all` |

## Shell access

```bash
task project:operate:ssh:{service}
```

Available: Check `project/docker-compose.yml` for the list of services.

## Database operations

| Need      | Command                                 |
|-----------|-----------------------------------------|
| Backup DB | `task project:operate:{service}:save`   |
| Repair DB | `task project:operate:{service}:repair` |

## Environment

| Need            | Command                     |
|-----------------|-----------------------------|
| Show env vars   | `task project:operate:env`  |
| Initialize .env | `task project:operate:init` |

## Decision tree

**Need fresh start?**
1. `task project:operate:down` — Stop containers
2. `task project:operate:destroy` — If volumes corrupted
3. `task project:operate:prune:all` — If Docker cache issues
4. `task deploy` — Restart clean

**Database issues?**
1. Backup first: `task project:operate:{db-service}:save`
2. Check migrations logs
3. Repair if needed
