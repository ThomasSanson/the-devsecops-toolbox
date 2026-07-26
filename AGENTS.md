# AGENTS.md

> **This file is the single entry point for every AI coding agent working on this repository.**
> Before taking any action, you **MUST** read and follow the rules in `.agent/`.

This repository is built on **The DevSecOps Toolbox**, a [Copier](https://copier.readthedocs.io) framework.
It provides a full GitLab CI/CD pipeline and a set of `task` workflows organised around the DevSecOps phases.
The framework tooling under `.config/` and the root `Taskfile.yml` are owned by the toolbox and evolve through `task copier:update`; do not edit them here.

> **If `.agent/rules/framework-repo.md` exists, this *is* The DevSecOps Toolbox template repository itself — read that rule for the repository-specific structure, test suite and constraints.**

---

## Mandatory Rules

**You MUST read and comply with ALL rule files before performing any action.**

| Rule file                                                                  | Description                                                                                                                 |
|----------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------|
| [`.agent/rules/task-commands.md`](.agent/rules/task-commands.md)           | All commands MUST go through `task` from the repository root. Never use `docker compose`, `npm run`, or `cd` directly.      |
| [`.agent/rules/environment.md`](.agent/rules/environment.md)               | Environment files live at the repository root only (`.env.dist`, `.env.dev`). Never create `.env`. Never modify `.config/`. |
| [`.agent/rules/stability.md`](.agent/rules/stability.md)                   | Respect the inherited architecture. Never modify `.config/` or the root `Taskfile.yml` — they are framework-managed.        |
| [`.agent/rules/tdd-cycle.md`](.agent/rules/tdd-cycle.md)                   | TDD is mandatory for ANY code change. Follow RED → GREEN → REFACTOR in strict order.                                        |
| [`.agent/rules/tests-integrity.md`](.agent/rules/tests-integrity.md)       | Never modify a test to hide a failure. Never delete or weaken existing tests.                                               |
| [`.agent/rules/tests-structure.md`](.agent/rules/tests-structure.md)       | Test conventions (Gherkin BDD, structure, tags).                                                                            |
| [`.agent/rules/naming-conventions.md`](.agent/rules/naming-conventions.md) | Naming and code-style conventions, script organisation, minimalism principle.                                               |
| [`.agent/rules/interaction.md`](.agent/rules/interaction.md)               | Mirror the user's language. Be professional, direct, and proactive.                                                         |
| [`.agent/rules/terminal-execution.md`](.agent/rules/terminal-execution.md) | Redirect terminal output to `./tmp/exec_logs.log`. Read the log if the terminal hangs instead of waiting.                   |
| [`.agent/rules/version-control.md`](.agent/rules/version-control.md)       | Git conventions for this repository.                                                                                        |

---

## Project Overview

- **Type**: a repository built on The DevSecOps Toolbox (Copier framework)
- **Tech stack**: Taskfile (Go Task) + Docker + GitLab CI/CD + Gherkin (BDD)
- **Inherited framework**: `.config/` and the root `Taskfile.yml` are owned by the toolbox. Do NOT edit them here — your changes would be lost on the next upgrade. Upgrades arrive as a single merge request that runs `task copier:update` (driven by Renovate against `.config/devsecops/.copier-answers.yml`); when auto-merge is enabled, minor and patch updates merge on their own.

### Key Directory Structure

```text
/
├── .agent/           # AI agent instructions (rules, skills, workflows) — read these first
├── .config/          # Framework tooling — managed by the toolbox, do NOT edit
├── docs/             # Documentation
├── Taskfile.yml      # Root orchestrator — managed by the toolbox, do NOT edit
├── .env.dist         # Default env values (no secrets)
├── .env.dev          # Local/dev overrides (dev secrets only)
├── .gitlab-ci.yml    # Inherited CI/CD pipeline
└── project/          # Your workspace (present when the project workspace is enabled)
    └── Taskfile.yml  # Add your own tasks HERE
```

---

## Commands

**All commands MUST be run via `task` from the repository root. No exceptions.**

```bash
task            # List every available task
task deploy     # Build + start all services
task build      # Build all Docker images
task test       # Full test suite
task code       # Run linters (MegaLinter)
task plan       # Planning tasks (Renovate, etc.)
task release    # Bump version, push tags
task operate    # Operational tasks
task monitor    # Monitoring tasks
```

### Forbidden Commands

```bash
# ❌ NEVER run these directly:
docker compose up -d
docker compose exec backend bash
cd project && npm run test
npm run anything
npx anything
```

If a task you need does not exist, **create it** in `project/Taskfile.yml`, following the DevSecOps phases: `project:{phase}:{service}:{action}` where `{phase}` is one of `plan`, `code`, `build`, `test`, `release`, `deploy`, `operate`, `monitor`, `feedback`.

---

## Skills

**Consult the relevant skill file before performing an action in that domain.**

| Skill       | File                                                               | When to use                                                          |
|-------------|--------------------------------------------------------------------|----------------------------------------------------------------------|
| **Build**   | [`.agent/skills/build/SKILL.md`](.agent/skills/build/SKILL.md)     | After Dockerfile changes, dependency updates, or before first deploy |
| **Code**    | [`.agent/skills/code/SKILL.md`](.agent/skills/code/SKILL.md)       | Running linters, fixing code style, before committing                |
| **Deploy**  | [`.agent/skills/deploy/SKILL.md`](.agent/skills/deploy/SKILL.md)   | Starting the environment, after pulling changes, before tests        |
| **Test**    | [`.agent/skills/test/SKILL.md`](.agent/skills/test/SKILL.md)       | Running tests, debugging failures, managing test data                |
| **TDD**     | [`.agent/skills/tdd/SKILL.md`](.agent/skills/tdd/SKILL.md)         | Implementing features, fixing bugs — RED → GREEN → REFACTOR          |
| **Operate** | [`.agent/skills/operate/SKILL.md`](.agent/skills/operate/SKILL.md) | Stopping services, shell access, database operations                 |
| **Monitor** | [`.agent/skills/monitor/SKILL.md`](.agent/skills/monitor/SKILL.md) | Investigating failures, checking logs, running diagnostics           |

---

## Workflows

**Follow workflow steps IN ORDER. Do NOT skip steps. Do NOT stop at planning.**

| Workflow                 | File                                                                               | Description                                     |
|--------------------------|------------------------------------------------------------------------------------|-------------------------------------------------|
| **Development Cycle**    | [`.agent/workflows/development-cycle.md`](.agent/workflows/development-cycle.md)   | Mandatory TDD workflow for any code change      |
| **TDD Step 1: Red**      | [`.agent/workflows/tdd-step1-red.md`](.agent/workflows/tdd-step1-red.md)           | Write a failing test specification              |
| **TDD Step 2: Green**    | [`.agent/workflows/tdd-step2-green.md`](.agent/workflows/tdd-step2-green.md)       | Implement minimal code to make the test pass    |
| **TDD Step 3: Refactor** | [`.agent/workflows/tdd-step3-refactor.md`](.agent/workflows/tdd-step3-refactor.md) | Improve code quality without changing behaviour |
| **Create Feature**       | [`.agent/workflows/create-feature.md`](.agent/workflows/create-feature.md)         | Implement a new feature using TDD with Gherkin  |
| **Read Feature**         | [`.agent/workflows/read-feature.md`](.agent/workflows/read-feature.md)             | List existing domains and features              |
| **Update Feature**       | [`.agent/workflows/update-feature.md`](.agent/workflows/update-feature.md)         | Add functionality to an existing feature        |
| **Delete Feature**       | [`.agent/workflows/delete-feature.md`](.agent/workflows/delete-feature.md)         | Safely remove a feature and its related files   |

---

## Testing — TDD is Mandatory

Detailed rules: [`.agent/rules/tdd-cycle.md`](.agent/rules/tdd-cycle.md) | Skill: [`.agent/skills/tdd/SKILL.md`](.agent/skills/tdd/SKILL.md)

Every code change MUST follow this cycle:

| Step | Action                                      | Command                                         | Expected          |
|------|---------------------------------------------|-------------------------------------------------|-------------------|
| 1    | Write test specification with unique `@tag` | —                                               | Test file created |
| 2    | **RED** — Verify test fails                 | `task test -- --grep "@tag"`                    | FAIL              |
| 3    | **Prove the failure is real**               | `task devsecops:test:check:red-is-real -- @tag` | PASS              |
| 4    | Implement minimal code                      | —                                               | Code written      |
| 5    | **GREEN** — Verify test passes              | `task test -- --grep "@tag"`                    | PASS              |
| 6    | Refactor (DO NOT touch test)                | —                                               | Code improved     |
| 7    | Verify after refactor                       | `task test -- --grep "@tag"`                    | PASS              |
| 8    | Quality check                               | `task code`                                     | PASS              |
| 9    | Full test suite                             | `task test`                                     | ALL PASS          |

**Each phase of the loop certifies itself**: one command, one exit code, nothing taken on trust.

### What certifies each phase

| Phase  | The command that settles it  | It guarantees                                         |
|--------|------------------------------|-------------------------------------------------------|
| `code` | `task devsecops:code:verify` | the linter passes, and the change silenced none of it |
| `test` | `task devsecops:test:verify` | the tests pass, and no check was switched off         |

Handing work to an AI assistant? The whole contract — including what an
orchestrator delegating to a cheaper model must check — is one page:
[`.agent/rules/ai-delegation.md`](.agent/rules/ai-delegation.md).


Test specifications are written in Gherkin, in the language configured for the project.
A visual-regression E2E engine (CodeceptJS + Gherkin, with a storyboard helper) ships under `.config/codeceptjs/`; use its sample config to wire up `project/tests/` if you want visual E2E coverage.

---

## Commit Conventions

Commits follow [Conventional Commits](https://www.conventionalcommits.org), enforced by commitlint in CI; `task release` (semantic-release) derives the version and changelog from them, with git tags in the `${version}` format (no `v` prefix). Use `commitizen` to compose a compliant message if unsure.

---

## Boundaries

### ✅ Always Do

- Run all commands via `task` from the repository root
- Follow the TDD cycle (RED → GREEN → REFACTOR) for any code change
- Run `task code` before committing
- Run `task test` to verify no regressions
- Mirror the user's language in conversation
- Add new tasks in `project/Taskfile.yml` if missing

### ⚠️ Ask First

- Before modifying existing test files
- Before adding new dependencies
- Before modifying CI/CD configuration (`.gitlab-ci.yml`)
- Before removing any file

### 🚫 Never Do

- Never use `docker compose` directly
- Never use `cd` to change directory before running commands
- Never create a `.env` file
- Never modify `.config/` or the root `Taskfile.yml` — they are framework-managed and upgraded via `task copier:update`
- Never hardcode secrets in code
- Never write code before the test (TDD violation)
- Never modify a test to hide a failure
- Never delete or weaken existing tests
