# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Important:** This repository contains an `AGENTS.md` file and a `.agent/` directory. You MUST read `AGENTS.md` and all files in `.agent/rules/` before taking any action.

---

## Project Overview

**The DevSecOps Toolbox** is a [Copier](https://copier.readthedocs.io) template that scaffolds complete DevSecOps pipelines for GitLab CI/CD. It generates projects preconfigured with security scanning, linting, container management, and standardised workflows.

- **Tech stack**: Copier (Python) + Taskfile (Go Task) + Docker + CodeceptJS + Gherkin (BDD)
- **License**: EUPL-1.2

---

## Commands

**All commands MUST run via `task` from the repository root. No exceptions.**

```bash
# Core DevSecOps lifecycle
task deploy       # Build + start all services
task build        # Build all Docker images
task test         # Full test suite (deploy + test)
task code         # Run linters (MegaLinter)
task plan         # Planning tasks (Renovate, etc.)
task release      # Bump version, push tags

# Testing
task test -- --grep "@my-tag"             # Run tests filtered by tag
task test:tdd                             # TDD mode (no rebuild)
task project:test:e2e                     # E2E suite only (no guards)
task project:test:e2e -- --grep "@tag"    # E2E suite filtered by tag

# Operations
task project:deploy:light                 # Light deploy (no rebuild)
task project:operate:down                 # Stop services (keep volumes)
task project:operate:destroy              # Destroy everything
task project:operate:ssh:{service}        # SSH into container
task project:monitor:{service}            # View service logs

# Development setup
task dev:setup-environment
```

**Redirect output when commands may hang:**
```bash
task test 2>&1 | tee ./tmp/exec_logs.log
```
If the terminal hangs, read `./tmp/exec_logs.log` instead of waiting.

**Forbidden — never use directly:**
```bash
docker compose up/down/exec
npm run / npx
cd project && ...
```

---

## Architecture

### Repository Layout

```txt
/
├── .agent/           # AI agent rules, skills, and workflows (source of truth)
├── .config/          # Framework tooling — owned & evolved by THIS template repo
├── copier.yml        # Copier template questions and answers
├── Taskfile.yml      # Root orchestrator (owned here; + Taskfile.yml.jinja twin)
├── .env.dist         # Default env values (no secrets, versioned)
├── .env.dev          # Local/dev overrides (dev secrets, versioned)
└── project/          # Project-specific code
    ├── Taskfile.yml  # Add new tasks HERE
    └── tests/
        └── e2e/      # Unified E2E suite (single entry point — see tests/README.md)
            ├── codecept.conf.js
            ├── features/          # 01-install, 02-daily-work, 03-evolution
            ├── pages/             # GitLab Page Objects (masking for visual determinism)
            ├── support/           # helpers/, steps/, terminal/ (xterm capture engine)
            └── screenshots/base/  # Visual baselines (tolerance: 0)
```

### How Tests Work

The tests in `project/tests/e2e/` are **E2E tests for the developer journey on
the Copier template**: clone a blank project from the in-repo test GitLab, run
the working-branch installer, answer the Copier questions, then verify the
init-framework-devsecops merge request and the resulting GitLab configuration.
Every deterministic stage is proven by a pixel baseline (tolerance: 0),
terminal-side and GitLab-side; volatile content falls back to log/REST asserts.

Tests use [CodeceptJS](https://codecept.io) with Gherkin BDD, executed inside
the `codeceptjs` container via `task project:test:e2e`. See
`project/tests/README.md` for capture styles, baseline regeneration and
conventions. The former legacy suites `tests/{template,bootstrap,gitlab}/`
were deleted after their coverage was ported into `e2e/` (recoverable from
git history).

### Environment Layering

Taskfile loads dotenv in priority order (first wins): `.env` → `.env.dev` → `.env.dist`

- `.env.dist` — base defaults, no secrets, always versioned
- `.env.dev` — dev overrides, dev secrets only, versioned
- `.env` — production/staging overrides, never created by agents, not versioned

All Taskfile config variables are prefixed `TASK_` (e.g., `TASK_MEGALINTER_ENABLED`).

### Task Naming Convention

All project tasks follow: `project:{phase}:{service}:{action}`

Where `{phase}` is one of: `plan`, `code`, `build`, `test`, `release`, `deploy`, `operate`, `monitor`, `feedback`.

Example: `project:operate:xxx:env`, `project:monitor:xxx`

---

## TDD — Mandatory for Any Code Change

Every code change follows RED → GREEN → REFACTOR in strict order:

| Step | Action                         | Command                      | Expected             |
|------|--------------------------------|------------------------------|----------------------|
| 1    | Write test with unique `@tag`  | —                            | Feature file created |
| 2    | **RED** — Verify test fails    | `task test -- --grep "@tag"` | FAIL                 |
| 3    | Implement minimal code         | —                            | Code written         |
| 4    | **GREEN** — Verify test passes | `task test -- --grep "@tag"` | PASS                 |
| 5    | Refactor (do NOT touch test)   | —                            | Code improved        |
| 6    | Verify after refactor          | `task test -- --grep "@tag"` | PASS                 |
| 7    | Quality check                  | `task code`                  | PASS                 |
| 8    | Full test suite                | `task test`                  | ALL PASS             |

**Never write code before the test. Never modify a test to make it pass.**

---

## Visual Regression Tests — No Cheating

Visual regression tests (`assertVisualMatch`) are meaningful human-readable checks. The diff between actual and baseline must be **zero** (`tolerance: 0`). When a visual test fails:

**FORBIDDEN — these are cheats, never do them:**
- Raising `tolerance` in `codecept.conf.js`
- Lowering `threshold` in `codecept.conf.js`
- Skipping or commenting out a visual assertion
- Regenerating baselines just to make them match without understanding why they differ

**The only correct fixes:**
- If content differs → fix the code so the terminal output is correct
- If rendering differs between environments (sub-pixel, font, DPI) → fix the Chromium launch args in `codecept.conf.js` to force deterministic rendering (e.g. SwiftShader WebGL, device scale factor, color profile)
- If the environment itself differs → regenerate baselines **in the same environment** where the CI runs, not locally with a different OS/font stack

---

## Critical Rules

- **Never** run `git add`, `git commit`, `git push`, or any git command that modifies the repository
- **Never** use `docker compose`, `npm run`, or `cd` into subdirectories
- **Ask before** modifying existing tests, adding dependencies, or changing CI/CD config (`.gitlab-ci.yml`)
