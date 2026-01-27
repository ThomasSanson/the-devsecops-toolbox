---
name: deploy
description: Deploy project services with Docker Compose. Use when starting the environment, after pulling changes, or when services need restart.
---

# Deploy

## When to use this skill

- Starting the environment for first time
- After pulling changes from git
- When services need full restart
- Before running tests

## How to deploy

### Full deploy (build + start)

```bash
task deploy
```

This will:
1. Build all Docker images
2. Start all services
3. Wait for health checks
4. Display access URLs

### Light deploy (no rebuild)

```bash
task project:deploy:light
```

Use when containers exist but are stopped.

### Remote deploy

```bash
task project:deploy:remote
```

Requires: `SSH_USER`, `SERVER`, `REMOTE_APP_DIR`, `ENV_VARS`

## Services deployed

Check `project/docker-compose.yml` for the list of services.

## Decision tree

**Deploy failing?**
1. Check Docker daemon running
2. Check ports not already in use
3. Check disk space
4. Run `task project:operate:destroy` then retry
5. Check service logs after start

## Access URLs

After deploy, read `.env.dev` for service URLs and ports.

## Rules

- ✅ ALWAYS use `task deploy` from root
- ❌ NEVER use `docker compose up` directly
