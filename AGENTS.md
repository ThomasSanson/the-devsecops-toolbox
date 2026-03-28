# AGENTS.md

> **This file is the single entry point for all AI coding agents working on this repository.**
> Before taking any action, you **MUST** read and follow the detailed instructions in `.agent/`.

---

## Mandatory Rules

**You MUST read and comply with ALL rule files before performing any action.**

| Rule file                                                                  | Description                                                                                                             |
|----------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------|
| [`.agent/rules/task-commands.md`](.agent/rules/task-commands.md)           | All commands MUST go through `task` from repository root. Never use `docker compose`, `npm run`, or `cd` directly.      |
| [`.agent/rules/environment.md`](.agent/rules/environment.md)               | Environment files live at repository root only (`.env.dist`, `.env.dev`). Never create `.env`. Never modify `.config/`. |
| [`.agent/rules/stability.md`](.agent/rules/stability.md)                   | Respect existing architecture. Never modify `.config/` or root `Taskfile.yml`.                                          |
| [`.agent/rules/tdd-cycle.md`](.agent/rules/tdd-cycle.md)                   | TDD is mandatory for ANY code change. Follow RED → GREEN → REFACTOR in strict order.                                    |
| [`.agent/rules/tests-integrity.md`](.agent/rules/tests-integrity.md)       | Never modify a test to hide a failure. Never delete or weaken existing tests.                                           |
| [`.agent/rules/tests-structure.md`](.agent/rules/tests-structure.md)       | Tests separated by type: business in `tests/application/`, infrastructure in `tests/{infra-name}/`.                     |
| [`.agent/rules/code-style.md`](.agent/rules/code-style.md)                 | Code style conventions, script organisation, language conventions, minimalism principle.                                |
| [`.agent/rules/interaction.md`](.agent/rules/interaction.md)               | Mirror the user's language. Be professional, direct, and proactive.                                                     |
| [`.agent/rules/terminal-execution.md`](.agent/rules/terminal-execution.md) | Redirect terminal output to `./tmp/exec_logs.log`. Check the log file if the terminal hangs instead of waiting.         |
| [`.agent/rules/version-control.md`](.agent/rules/version-control.md)       | Never run `git add`, `git commit`, `git push`, or any git command that modifies the repository. Read-only git only.     |

---

## Project Overview

- **Type**: Copier template for DevSecOps pipeline scaffolding
- **Tech stack**: Copier (Python) + Taskfile (Go Task) + Docker + CodeceptJS/Playwright (E2E) + Gherkin (BDD)
- **Architecture**: Microservices — each service is a subfolder in `project/`
- **License**: EUPL-1.2

### Key Directory Structure

```text
/
├── .agent/                  # AI agent instructions (rules, skills, workflows)
├── .config/                 # Tool-specific configurations (DO NOT MODIFY)
├── docs/                    # Documentation
├── project/                 # Project-specific code and services
│   ├── Taskfile.yml         # Project tasks (add new tasks here)
│   └── tests/               # Test suites
│       ├── application/     # Business E2E tests (Gherkin, French)
│       └── {infra-name}/    # Infrastructure tests (isolated per tool)
├── copier.yml               # Copier template configuration
├── Taskfile.yml             # Root orchestrator (DO NOT MODIFY)
├── .env.dist                # Default env values (no secrets)
└── .env.dev                 # Local/dev overrides (dev secrets only)
```

---

## Commands

**All commands MUST be run via `task` from the repository root. No exceptions.**

### Core DevSecOps Commands

```bash
task deploy                  # Build + start all services
task build                   # Build all Docker images
task test                    # Run full test suite
task code                    # Run linters (Mega-Linter)
task plan                    # Run planning tasks (Renovate, etc.)
task release                 # Bump version, push tags
task operate                 # Operational tasks
task monitor                 # Monitoring tasks
```

### Testing Commands

```bash
task test                              # Full test suite (deploy + test)
task test -- --grep "@my-tag"          # Run tests filtered by tag
task test:tdd                          # TDD mode (no rebuild)
task project:test:application          # Application tests only
task project:test:application -- --grep "@tag" --steps  # Filtered + verbose
```

### Operations Commands

```bash
task project:deploy:light              # Light deploy (no rebuild)
task project:operate:down              # Stop services (keep volumes)
task project:operate:destroy           # Destroy everything
task project:operate:ssh:{service}     # SSH into container
task project:monitor:{service}         # View service logs
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

If a task you need does not exist, **create it** in `project/Taskfile.yml` following DevSecOps phases (plan, code, build, test, release, deploy, operate, monitor, feedback).

---

## Skills

**Consult the relevant skill file before performing an action in that domain.**

| Skill       | File                                                               | When to use                                                          |
|-------------|--------------------------------------------------------------------|----------------------------------------------------------------------|
| **Build**   | [`.agent/skills/build/SKILL.md`](.agent/skills/build/SKILL.md)     | After Dockerfile changes, dependency updates, or before first deploy |
| **Code**    | [`.agent/skills/code/SKILL.md`](.agent/skills/code/SKILL.md)       | Running linters, fixing code style, before committing                |
| **Deploy**  | [`.agent/skills/deploy/SKILL.md`](.agent/skills/deploy/SKILL.md)   | Starting environment, after pulling changes, before tests            |
| **Test**    | [`.agent/skills/test/SKILL.md`](.agent/skills/test/SKILL.md)       | Running E2E tests, debugging failures, managing test data            |
| **TDD**     | [`.agent/skills/tdd/SKILL.md`](.agent/skills/tdd/SKILL.md)         | Implementing features, fixing bugs — RED → GREEN → REFACTOR          |
| **Operate** | [`.agent/skills/operate/SKILL.md`](.agent/skills/operate/SKILL.md) | Stopping services, shell access, database operations                 |
| **Monitor** | [`.agent/skills/monitor/SKILL.md`](.agent/skills/monitor/SKILL.md) | Investigating failures, checking logs, running diagnostics           |

---

## Workflows

**Follow workflow steps IN ORDER. Do NOT skip steps. Do NOT stop at planning.**

| Workflow                 | File                                                                               | Description                                                                                     |
|--------------------------|------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| **Development Cycle**    | [`.agent/workflows/development-cycle.md`](.agent/workflows/development-cycle.md)   | Mandatory TDD workflow for any code change (DEPLOY → RED → GREEN → REFACTOR → LINT → FULL TEST) |
| **TDD Step 1: Red**      | [`.agent/workflows/tdd-step1-red.md`](.agent/workflows/tdd-step1-red.md)           | Write a failing test specification                                                              |
| **TDD Step 2: Green**    | [`.agent/workflows/tdd-step2-green.md`](.agent/workflows/tdd-step2-green.md)       | Implement minimal code to make the test pass                                                    |
| **TDD Step 3: Refactor** | [`.agent/workflows/tdd-step3-refactor.md`](.agent/workflows/tdd-step3-refactor.md) | Improve code quality without changing behaviour                                                 |
| **Create Feature**       | [`.agent/workflows/create-feature.md`](.agent/workflows/create-feature.md)         | Implement a new template feature using TDD with Gherkin                                         |
| **Read Feature**         | [`.agent/workflows/read-feature.md`](.agent/workflows/read-feature.md)             | List existing domains and features                                                              |
| **Update Feature**       | [`.agent/workflows/update-feature.md`](.agent/workflows/update-feature.md)         | Add functionality to an existing feature                                                        |
| **Delete Feature**       | [`.agent/workflows/delete-feature.md`](.agent/workflows/delete-feature.md)         | Safely remove a feature and its related files                                                   |

---

## Code Style Summary

Detailed rules: [`.agent/rules/code-style.md`](.agent/rules/code-style.md)

- **Scripts**: Externalise in dedicated files (`project/{service}/scripts/`). Never inline in Taskfile.
- **Language conventions**: Refer to `.agent/rules/code-style.md` for project-specific language and naming conventions.
- **Minimalism**: Add only what is explicitly requested. Follow existing style. No superfluous properties.

---

## Testing — TDD is Mandatory

Detailed rules: [`.agent/rules/tdd-cycle.md`](.agent/rules/tdd-cycle.md) | Skill: [`.agent/skills/tdd/SKILL.md`](.agent/skills/tdd/SKILL.md)

Every code change MUST follow this cycle:

| Step | Action                                      | Command                      | Expected          |
|------|---------------------------------------------|------------------------------|-------------------|
| 1    | Write test specification with unique `@tag` | —                            | Test file created |
| 2    | **RED** — Verify test fails                 | `task test -- --grep "@tag"` | FAIL              |
| 3    | Implement minimal code                      | —                            | Code written      |
| 4    | **GREEN** — Verify test passes              | `task test -- --grep "@tag"` | PASS              |
| 5    | Refactor (DO NOT touch test)                | —                            | Code improved     |
| 6    | Verify after refactor                       | `task test -- --grep "@tag"` | PASS              |
| 7    | Quality check                               | `task code`                  | PASS              |
| 8    | Full test suite                             | `task test`                  | ALL PASS          |

---

## Boundaries

### ✅ Always Do

- Run all commands via `task` from repository root
- Follow the TDD cycle (RED → GREEN → REFACTOR) for any code change
- Run `task code` before committing
- Run `task test` to verify no regressions
- Write test specifications with unique `@tag` for isolation
- Follow test patterns defined in `.agent/rules/tests-structure.md`
- Add new tasks in `project/Taskfile.yml` if missing
- Place environment variables in `.env.dist` (defaults) or `.env.dev` (dev overrides)
- Mirror the user's language in conversation

### ⚠️ Ask First

- Before modifying existing test files
- Before adding new dependencies
- Before changing database schemas
- Before modifying CI/CD configuration (`.gitlab-ci.yml`)
- Before removing any file

### 🚫 Never Do

- Never use `docker compose` directly
- Never use `cd` to change directory before running commands
- Never create a `.env` file
- Never modify `.config/` directory contents
- Never modify root `Taskfile.yml`
- Never hardcode secrets in code
- Never write code before the test (TDD violation)
- Never modify a test to hide a failure
- Never delete or weaken existing tests
- Never skip TDD steps
- Never commit secrets or API keys
- Never place infrastructure tests in `tests/application/`
- Never run `git add`, `git commit`, `git push`, or any git command that modifies the repository
