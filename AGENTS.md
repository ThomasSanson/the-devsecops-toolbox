# AGENTS.md

> **This file is the single entry point for every AI coding agent working on this repository.**
> Before taking any action, you **MUST** read and follow the rules in `.agents/`.

This repository is built on **The DevSecOps Toolbox**, a [Copier](https://copier.readthedocs.io) framework.
It provides a full GitLab CI/CD pipeline and a set of `task` workflows organised around the DevSecOps phases.
The framework tooling under `.config/` and the root `Taskfile.yml` are owned by the toolbox and evolve through `task copier:update`; do not edit them here.

> **If `.agents/rules/framework-repo.md` exists, this *is* The DevSecOps Toolbox template repository itself — read that rule for the repository-specific structure, test suite and constraints.**
>
> **If `.config/devsecops/Taskfile.test.yml` does not exist, only the AI files were installed, not the framework: the `task` and `devsecops` commands here do not exist. Use the project's own build and test commands, and say which one you ran.**

---

## Mandatory Rules

**You MUST read and comply with ALL rule files before performing any action.**

| Rule file                                                                    | Description                                                                                                                 |
|------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------|
| [`.agents/rules/task-commands.md`](.agents/rules/task-commands.md)           | Build, lint, test and deploy go through `task` from the repository root. Reading files and read-only git commands do not.   |
| [`.agents/rules/environment.md`](.agents/rules/environment.md)               | Environment files live at the repository root only (`.env.dist`, `.env.dev`). Never create `.env`. Never modify `.config/`. |
| [`.agents/rules/stability.md`](.agents/rules/stability.md)                   | Never modify `.config/` or the root `Taskfile.yml`. A failure rooted there is fixed in the toolbox, never here.             |
| [`.agents/rules/tdd-cycle.md`](.agents/rules/tdd-cycle.md)                   | TDD is mandatory for ANY code change. Follow RED → GREEN → REFACTOR in strict order.                                        |
| [`.agents/rules/tests-integrity.md`](.agents/rules/tests-integrity.md)       | Never modify a test to hide a failure. Never delete or weaken existing tests.                                               |
| [`.agents/rules/tests-structure.md`](.agents/rules/tests-structure.md)       | Test conventions (Gherkin BDD, structure, tags).                                                                            |
| [`.agents/rules/naming-conventions.md`](.agents/rules/naming-conventions.md) | Task names follow `project:{phase}:{service}:{action}`. Taskfile variables start with `TASK_`.                              |
| [`.agents/rules/interaction.md`](.agents/rules/interaction.md)               | Mirror the user's language. Be professional, direct, and proactive.                                                         |
| [`.agents/rules/terminal-execution.md`](.agents/rules/terminal-execution.md) | Send long output to `tmp/exec_logs.log` with `>`, never through a pipe that hides the exit code. Read the log if it hangs.  |
| [`.agents/rules/version-control.md`](.agents/rules/version-control.md)       | Agents only read git. The person commits.                                                                                   |

---

## Project Overview

- **Type**: a repository built on The DevSecOps Toolbox (Copier framework)
- **Tech stack**: Taskfile (Go Task) + Docker + GitLab CI/CD + Gherkin (BDD)
- **Inherited framework**: `.config/` and the root `Taskfile.yml` are owned by the toolbox. Do NOT edit them here — your changes would be lost on the next upgrade. Upgrades arrive as a single merge request that runs `task copier:update` (driven by Renovate against `.config/devsecops/.copier-answers.yml`); when auto-merge is enabled, minor and patch updates merge on their own.

### Key Directory Structure

```text
/
├── .agents/          # AI agent instructions (rules and skills) — read these first
├── .claude/skills/   # One link per skill in .agents/skills, for the tools that read skills there
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

**Build, lint, test and deploy go through `task` from the repository root. Reading files and read-only git commands do not.**

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

If the command you need has no task, **create one** in `project/Taskfile.yml`, following the DevSecOps phases: `project:{phase}:{service}:{action}` where `{phase}` is one of `plan`, `code`, `build`, `test`, `release`, `deploy`, `operate`, `monitor`, `feedback`.

---

## Skills

**Consult the relevant skill file before performing an action in that domain.**

| Skill       | File                                                                 | When to use                                                          |
|-------------|----------------------------------------------------------------------|----------------------------------------------------------------------|
| **Build**   | [`.agents/skills/build/SKILL.md`](.agents/skills/build/SKILL.md)     | After Dockerfile changes, dependency updates, or before first deploy |
| **Code**    | [`.agents/skills/code/SKILL.md`](.agents/skills/code/SKILL.md)       | Running linters, fixing code style, before committing                |
| **Deploy**  | [`.agents/skills/deploy/SKILL.md`](.agents/skills/deploy/SKILL.md)   | Starting the environment, after pulling changes, before tests        |
| **Test**    | [`.agents/skills/test/SKILL.md`](.agents/skills/test/SKILL.md)       | Running tests, debugging failures, writing new tests                 |
| **TDD**     | [`.agents/skills/tdd/SKILL.md`](.agents/skills/tdd/SKILL.md)         | Implementing features, fixing bugs — RED → GREEN → REFACTOR          |
| **Operate** | [`.agents/skills/operate/SKILL.md`](.agents/skills/operate/SKILL.md) | Stopping services, shell access, database operations                 |
| **Monitor** | [`.agents/skills/monitor/SKILL.md`](.agents/skills/monitor/SKILL.md) | Investigating failures, checking logs, debugging                     |

---

## Step-by-step skills

**Follow their steps IN ORDER. Do NOT skip steps. Do NOT stop at a plan when asked to implement.**

| Skill                    | File                                                                                       | Description                                     |
|--------------------------|--------------------------------------------------------------------------------------------|-------------------------------------------------|
| **Development Cycle**    | [`.agents/skills/development-cycle/SKILL.md`](.agents/skills/development-cycle/SKILL.md)   | Mandatory TDD workflow for any code change      |
| **TDD Step 1: Red**      | [`.agents/skills/tdd-step1-red/SKILL.md`](.agents/skills/tdd-step1-red/SKILL.md)           | Write a failing test specification              |
| **TDD Step 2: Green**    | [`.agents/skills/tdd-step2-green/SKILL.md`](.agents/skills/tdd-step2-green/SKILL.md)       | Implement minimal code to make the test pass    |
| **TDD Step 3: Refactor** | [`.agents/skills/tdd-step3-refactor/SKILL.md`](.agents/skills/tdd-step3-refactor/SKILL.md) | Improve code quality without changing behaviour |
| **Create Feature**       | [`.agents/skills/create-feature/SKILL.md`](.agents/skills/create-feature/SKILL.md)         | Implement a new feature using TDD with Gherkin  |
| **Read Feature**         | [`.agents/skills/read-feature/SKILL.md`](.agents/skills/read-feature/SKILL.md)             | List existing domains and features              |
| **Update Feature**       | [`.agents/skills/update-feature/SKILL.md`](.agents/skills/update-feature/SKILL.md)         | Add functionality to an existing feature        |
| **Delete Feature**       | [`.agents/skills/delete-feature/SKILL.md`](.agents/skills/delete-feature/SKILL.md)         | Safely remove a feature and its related files   |

---

## Testing — TDD is Mandatory

Detailed rules: [`.agents/rules/tdd-cycle.md`](.agents/rules/tdd-cycle.md) | Skill: [`.agents/skills/tdd/SKILL.md`](.agents/skills/tdd/SKILL.md)

Every code change MUST follow this cycle:

| Step | Action                         | Command                                         | Expected      |
|------|--------------------------------|-------------------------------------------------|---------------|
| 1    | Write a test tagged `@tag`     | —                                               | Test written  |
| 2    | **RED** — Verify test fails    | `task test -- --grep "@tag"`                    | FAIL          |
| 3    | **Prove the failure is real**  | `task devsecops:test:check:red-is-real -- @tag` | PASS          |
| 4    | Implement minimal code         | —                                               | Code written  |
| 5    | **GREEN** — Verify test passes | `task test -- --grep "@tag"`                    | PASS          |
| 6    | Refactor (DO NOT touch test)   | —                                               | Code improved |
| 7    | Verify after refactor          | `task test -- --grep "@tag"`                    | PASS          |
| 8    | Quality check                  | `task devsecops:code:verify`                    | PASS          |
| 9    | Full test suite                | `task devsecops:test:verify`                    | ALL PASS      |

Step 1 accepts a Gherkin scenario or a unit test whose name starts with the tag.

Steps 8 and 9 each certify a phase with one exit code: the linter passes and the change silenced none of it, then the tests pass and no check was switched off.

Handing work to an AI assistant? The whole contract — including what an
orchestrator delegating to a cheaper model must check — is one page:
[`.agents/rules/ai-delegation.md`](.agents/rules/ai-delegation.md).

Gherkin scenarios are written in the language configured for the project.
A visual-regression E2E engine (CodeceptJS + Gherkin, with a storyboard helper) ships under `.config/codeceptjs/`; use its sample config to wire up `project/tests/` if you want visual E2E coverage.

---

## Commit Conventions

Commits follow [Conventional Commits](https://www.conventionalcommits.org), enforced by commitlint in CI; `task release` (semantic-release) derives the version and changelog from them, with git tags in the `${version}` format (no `v` prefix). Who runs git is set by `version-control.md`. `commitizen` helps compose a compliant message.

---

## Boundaries

### ✅ Always Do

- Build, lint, test and deploy through `task` from the repository root
- Follow the TDD cycle (RED → GREEN → REFACTOR) for any code change
- Run `task devsecops:code:verify` before committing
- Run `task devsecops:test:verify` to verify no regressions
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
