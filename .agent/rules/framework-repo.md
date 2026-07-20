---
trigger: always_on
description: You are in The DevSecOps Toolbox template repository itself — repository-specific structure, test suite and constraints
---

# This IS The DevSecOps Toolbox (template repository)

The presence of this file means you are working **in the toolbox template repository itself**, not in a generated project.
Here, `.config/`, the root `Taskfile.yml` and their `.jinja` twins ARE the product: they are owned and evolved here.
The generic "never modify `.config/` / root `Taskfile.yml`" rules in `AGENTS.md`, `CLAUDE.md` and the other `.agent/rules/` are written for the generated-project audience; they do not forbid maintaining the template itself.
Everything still runs through `task` from the repository root, and the TDD cycle still applies to every change.

---

## What this repository is

- **Type**: a [Copier](https://copier.readthedocs.io) template that scaffolds complete DevSecOps pipelines for GitLab CI/CD
- **Tech stack**: Copier (Python) + Taskfile (Go Task) + Docker + CodeceptJS (E2E) + Gherkin (BDD)
- **Architecture**: `project/` is the scaffolded workspace (`gitlab/`, `tests/`, `ubuntu/`), not one service per subfolder
- **License**: EUPL-1.2

This repo is the **source of truth for `.config/`**: it owns and upgrades every tool under `.config/` (task, copier, gum, glow, …).
Its own Renovate config (`.config/renovate/config.json`) tracks those tools at both endpoints — the `.config/<tool>/version` files AND the `install.sh` bootstrap pins, kept in lockstep.
Projects generated FROM this template inherit a deliberately LIGHTER Renovate (`config.json.jinja`) that does NOT track `.config/`: it only watches the framework-evolution MR (`.copier-answers.yml` → `task copier:update`) plus its own `project/**` deps.
So tool upgrades flow framework → generated projects via one Copier MR, never per-tool MRs in every downstream repo. Enforced by `features/03-evolution/renovate.feature`.

Detailed code style for this repository: [`.agent/rules/code-style.md`](.agent/rules/code-style.md) (framework-only; not shipped downstream).

### Key directory structure

```text
/
├── .agent/                  # AI agent instructions (rules, skills, workflows; .jinja twins ship downstream)
├── .config/                 # Framework tooling — owned & evolved by THIS template repo
├── docs/                    # Documentation
├── copier.yml               # Copier template questions
├── Taskfile.yml             # Root orchestrator (+ Taskfile.yml.jinja twin)
├── .env.dist                # Default env values (no secrets)
├── .env.dev                 # Local/dev overrides (dev secrets only)
└── project/                 # Scaffolded workspace shipped to generated projects
    ├── gitlab/              # In-repo GitLab CE used by the E2E tests
    ├── ubuntu/              # Base image build context
    ├── Taskfile.yml         # Project tasks (add new tasks here)
    └── tests/
        └── e2e/             # Unified E2E suite (single entry point — see project/tests/README.md)
            ├── codecept.conf.js
            ├── features/          # 01-install, 02-daily-work, 03-evolution (three acts)
            ├── pages/             # GitLab Page Objects (masking for visual determinism)
            ├── support/           # helpers/, steps/, terminal/ (xterm capture engine)
            ├── storyboards/       # Committed SVG storyboards (one per journey)
            └── screenshots/base/  # Visual baselines (tolerance: 0)
```

Some files are framework-only and excluded from generated projects via `_exclude` in `copier.yml` (e.g. `.agent/rules/code-style.md`, this `framework-repo.md`, `README.md`, `project/gitlab`, `project/tests`, `project/ubuntu`).

---

## How the E2E tests work

The tests in `project/tests/e2e/` are **E2E tests for the developer journey on the Copier template**: clone a blank project from the in-repo test GitLab, run the working-branch installer, answer the Copier questions, then verify the `init-framework-devsecops` merge request and the resulting GitLab configuration.
Every deterministic stage is proven by a pixel baseline (tolerance: 0), terminal-side and GitLab-side; volatile content falls back to log/REST asserts.

Tests use [CodeceptJS](https://codecept.io) with Gherkin BDD, executed inside the `codeceptjs` container via `task project:test:e2e`.
See `project/tests/README.md` for capture styles, baseline regeneration and conventions.
The former legacy suites `tests/{template,bootstrap,gitlab}/` were deleted after their coverage was ported into `e2e/` (recoverable from git history).

### Framework test commands

```bash
task test                              # Full test suite (deploy + guards + e2e)
task test -- --grep "@my-tag"          # Run tests filtered by tag
task test:tdd                          # TDD mode (no rebuild)
task project:test:e2e                  # E2E suite only (no guards)
task project:test:e2e -- --grep "@tag" # E2E suite filtered by tag
```

After any change under `.config/codeceptjs/`, run `task project:build:tests` (the image is baked) before the next E2E run.

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

Baselines are regenerated locally then inspected; `TASK_E2E_UPDATE_BASELINES` is never set in CI.

---

## Git discipline in this repository

- Work on a feature branch and open a merge request; `main` is protected — never push to it directly and never `-o ci.skip`.
- Commit messages follow Conventional Commits (commitlint is a CI gate); `task release` (semantic-release) derives the version, with tags in the `${version}` format (no `v` prefix).
- Do not merge your own MR without explicit agreement — deliver a green pipeline and let review follow the project flow.
