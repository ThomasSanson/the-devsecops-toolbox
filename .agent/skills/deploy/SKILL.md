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

## Services deployed

Check `project/docker-compose.yml` for the list of services.

## Decision tree

**Deploy failing?**
1. Check Docker daemon running
2. Check ports not already in use
3. Check disk space
4. Check service logs after start

If a deploy fails, read the logs and fix the cause. Never run anything that deletes containers, volumes or data without the person's explicit go-ahead.

## Access URLs

After deploy, read `.env.dev` for service URLs and ports.

## Rules

- ✅ ALWAYS use `task deploy` from root
- ❌ NEVER use `docker compose up` directly
