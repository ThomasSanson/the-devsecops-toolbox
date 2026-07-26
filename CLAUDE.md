# CLAUDE.md

This file guides Claude Code (claude.ai/code) when working in this repository.

> **Important:** Read `AGENTS.md` and every file in `.agent/rules/` before taking any action.
> They are the source of truth for how to work here.
>
> **If `.agent/rules/framework-repo.md` exists, this *is* The DevSecOps Toolbox template repository itself — read that rule for the repository-specific structure, test suite and constraints.**

---

## Project Overview

This repository is built on [The DevSecOps Toolbox](https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox), a [Copier](https://copier.readthedocs.io) framework.
It provides a complete GitLab CI/CD pipeline: security scanning, linting, container management, and standardised `task` workflows.

- **Tech stack**: Taskfile (Go Task) + Docker + GitLab CI/CD
- **Inherited framework**: everything under `.config/` and the root `Taskfile.yml` comes from the toolbox and is upgraded automatically (see below).

---

## Commands

**All commands MUST run via `task` from the repository root. No exceptions.**

```bash
task            # List every available task
task deploy     # Build + start all services
task build      # Build all Docker images
task test       # Full test suite
task code       # Run linters (MegaLinter)
task plan       # Planning tasks (Renovate, etc.)
task release    # Bump version, push tags
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

Everything is a `task`. If a command you need does not exist, add it in `project/Taskfile.yml` — never bypass `task`.

---

## Architecture

### The framework is managed for you

`.config/` and the root `Taskfile.yml` are **owned by the toolbox**, not by this project.
Do not edit them here: your changes would be lost on the next upgrade.

Upgrades arrive as a single merge request that runs `task copier:update` (driven by Renovate against `.config/devsecops/.copier-answers.yml`).
Review that MR like any other change; when auto-merge is enabled, minor and patch updates merge on their own.

### Where things go

```txt
/
├── .agent/           # AI agent rules, skills, workflows (read these first)
├── .config/          # Framework tooling — managed by the toolbox, do NOT edit
├── Taskfile.yml      # Root orchestrator — managed by the toolbox, do NOT edit
├── .env.dist         # Default env values (no secrets, versioned)
├── .env.dev          # Local/dev overrides (dev secrets, versioned)
├── .gitlab-ci.yml    # Inherited pipeline
├── docs/             # Documentation
└── project/          # Your code (present when the project workspace is enabled)
    └── Taskfile.yml  # Add your own tasks HERE
```

### Environment layering

Taskfile loads dotenv in priority order (first wins): `.env` → `.env.dev` → `.env.dist`

- `.env.dist` — base defaults, no secrets, always versioned
- `.env.dev` — dev overrides, dev secrets only, versioned
- `.env` — production/staging overrides, never created by agents, not versioned

All Taskfile config variables are prefixed `TASK_` (e.g. `TASK_MEGALINTER_ENABLED`).

### Task naming convention

Add new tasks in `project/Taskfile.yml`, following: `project:{phase}:{service}:{action}`

Where `{phase}` is one of: `plan`, `code`, `build`, `test`, `release`, `deploy`, `operate`, `monitor`, `feedback`.

---

## TDD — Mandatory for Any Code Change

Every code change follows RED → GREEN → REFACTOR in strict order; see `.agent/rules/tdd-cycle.md`.

| Step | Action                         | Command                                         | Expected             |
|------|--------------------------------|-------------------------------------------------|----------------------|
| 1    | Write test with unique `@tag`  | —                                               | Feature file created |
| 2    | **RED** — Verify test fails    | `task test -- --grep "@tag"`                    | FAIL                 |
| 3    | **Prove the failure is real**  | `task devsecops:test:check:red-is-real -- @tag` | PASS                 |
| 4    | Implement minimal code         | —                                               | Code written         |
| 5    | **GREEN** — Verify test passes | `task test -- --grep "@tag"`                    | PASS                 |
| 6    | Refactor (do NOT touch test)   | —                                               | Code improved        |
| 7    | Verify after refactor          | `task test -- --grep "@tag"`                    | PASS                 |
| 8    | Quality check                  | `task code`                                     | PASS                 |
| 9    | Full test suite                | `task test`                                     | ALL PASS             |

**Never write code before the test. Never modify a test to make it pass.**

Step 3 is checked, not taken on your word: a run that dies while loading its files exits non-zero and records nothing, and that is a crash, not a failure.

**`task verify` is the one sentence that means "done"**: nothing was switched off, the linter is clean, the tests pass — one exit code. Each phase of the loop also certifies itself, so you can prove one step without running the rest. On a merge request the `no-cheat` job asks the same question again, whatever anyone ran locally.

### What certifies each phase

| Phase  | The command that settles it  | It guarantees                                              |
|--------|------------------------------|------------------------------------------------------------|
| `code` | `task devsecops:code:verify` | the linter passes, and the change silenced none of it      |
| `test` | `task devsecops:test:verify` | the tests pass, and no check was switched off              |
| any    | `task verify`                | both of the above, one exit code — the sentence for "done" |

Handing work to an AI assistant? The whole contract — including what an
orchestrator delegating to a cheaper model must check — is one page:
[`.agent/rules/ai-delegation.md`](.agent/rules/ai-delegation.md).


Test specifications are written in Gherkin (BDD), in the language configured for the project.
A visual-regression E2E engine (CodeceptJS + storyboard helper) ships under `.config/codeceptjs/`; wire it into `project/tests/` for visual E2E coverage.

---

## Commit Conventions

Commits follow [Conventional Commits](https://www.conventionalcommits.org), enforced by commitlint in CI.
`task release` (semantic-release) derives the version and changelog from commit messages; git tags use the `${version}` format (no `v` prefix).

---

## Critical Rules

- **Never** edit `.config/` or the root `Taskfile.yml` — they are framework-managed and upgraded via `task copier:update`.
- **Never** use `docker compose`, `npm run`, or `cd` into subdirectories — everything goes through `task`.
- Follow the TDD cycle (RED → GREEN → REFACTOR) for any code change; see `.agent/rules/tdd-cycle.md`.
- **Ask before** changing CI/CD config (`.gitlab-ci.yml`), adding dependencies, or modifying existing tests.
