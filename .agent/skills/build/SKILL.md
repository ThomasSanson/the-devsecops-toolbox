---
name: build
description: Build Docker images for project services. Use when images need rebuilding after Dockerfile changes or dependency updates.
---

# Build

## When to use this skill

- After modifying a Dockerfile
- After changing dependencies (package.json, pom.xml, requirements.txt)
- When images are outdated or corrupted
- Before first deploy

## How to build

### Build all services

```bash
task build
```

### Build specific service

```bash
task project:build:{service}
```

Available services: Check `project/docker-compose.yml` for the list of services.

## Decision tree

**Build failing?**
1. Check Docker daemon is running
2. Check Dockerfile syntax
3. Check base image availability
4. Check network for dependencies download
5. Run `task project:operate:prune:all` if cache corrupted

## Rules

- ✅ Build is automatic with `task deploy`
- ✅ Use specific build only for targeted rebuild
- ❌ NEVER run `docker build` directly
