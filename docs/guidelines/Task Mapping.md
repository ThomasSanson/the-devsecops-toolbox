# 🗺️ Task Mapping - The DevSecOps Toolbox

## Project Overview

**Type**: Copier Template for DevSecOps pipeline scaffolding
**Technology**: Copier (Python-based project templating) + Taskfile (Go Task)
**License**: EUPL-1.2
**Target**: Universal DevSecOps pipeline bootstrap for any project

---

## Environment Variables

### Loading Order
```txt
1. .env (user-specific, gitignored)
2. .env.dev (local/CI/test specific values)
3. .env.dist (defaults for all services)
```

### Key Variables

| Variable                   | Purpose                         | Default                 |
|----------------------------|---------------------------------|-------------------------|
| `TASK_FLAGS`               | Global task flags               | `""`                    |
| `TASK_DEVSECOPS_ICON`      | DevSecOps phase icon            | `♾️`                    |
| `TASK_*_ENABLED`           | Enable/disable specific tools   | `true`                  |
| `TASK_DEVSECOPS_*_ENABLED` | Enable/disable DevSecOps phases | `true`                  |
| `CODECEPTJS_BASE_URL`      | Base URL for E2E tests          | `http://localhost:8080` |

---

## Project Structure

```bash
.
├── .config/                    # Tool-specific configurations (30+ tools)
│   ├── ansible/               # Ansible playbooks and roles
│   ├── codeceptjs/            # E2E testing with Playwright
│   ├── commitizen/            # Commit message standardization
│   ├── commitlint/            # Commit message linting
│   ├── copier/                # Copier template management
│   ├── cspell/                # Spell checking
│   ├── dev/                   # Development environment setup
│   ├── devcontainer/          # DevContainer (Docker-based dev env)
│   ├── devsecops/             # Pipeline phase Taskfiles
│   │   ├── Taskfile.plan.yml
│   │   ├── Taskfile.code.yml
│   │   ├── Taskfile.build.yml
│   │   ├── Taskfile.test.yml
│   │   ├── Taskfile.release.yml
│   │   ├── Taskfile.deploy.yml
│   │   ├── Taskfile.operate.yml
│   │   ├── Taskfile.monitor.yml
│   │   └── Taskfile.feedback.yml
│   ├── docker-ce/             # Docker build/push
│   ├── betterleaks/              # Secret scanning
│   ├── gitlab/ci/             # GitLab CI configuration
│   ├── helm/                  # Helm chart management
│   ├── k3d/                   # Local Kubernetes cluster
│   ├── lizard/                # Code complexity analysis
│   ├── megalinter/            # Comprehensive linting
│   └── ...                    # Other tools
├── .devcontainer/             # VSCode DevContainer config
├── copier.yml                 # Copier template configuration
├── docs/                      # Documentation
├── project/                   # Project-specific customization
│   ├── Taskfile.yml          # Project tasks (prefixed `project:*`)
│   └── tests/e2e/            # Unified E2E suite (CodeceptJS + Gherkin)
│       ├── codecept.conf.js  # CodeceptJS configuration
│       ├── features/         # Gherkin feature files by domain
│       ├── pages/            # GitLab Page Objects
│       ├── support/          # helpers/, steps/, terminal/
│       └── screenshots/base/ # Visual baselines (tolerance: 0)
├── Taskfile.yml              # Root orchestration
└── Taskfile.yml.jinja        # Jinja template for Taskfile
```

---

## Available Tasks by DevOps Phase

### 🎯 Plan
```bash
task plan                      # Run all plan tasks
task devsecops:plan            # DevSecOps plan phase
```

### 💻 Code
```bash
task code                      # Run all code tasks
task betterleaks:scan-branch      # Scan branch for secrets
task betterleaks:protect          # Pre-commit secret scan
task commitlint                # Validate commit messages
task commitizen:check          # Check commitizen compliance
task commitizen:bump           # Bump version (dry-run)
task lizard                    # Code complexity analysis
task renovate:validate         # Validate renovate config
task megalinter:npx            # Run MegaLinter via npx
```

### 🏗️ Build
```bash
task build                     # Run all build tasks
task docker-ce:build           # Build Docker image
task docker-ce:build:all:dockerfile  # Build all Dockerfiles
```

### 🧪 Test
```bash
task test                      # Run all tests
task test:tdd                  # TDD workflow (build + test)
task project:test:copier       # Copier scaffolding tests
task codeceptjs:npx            # Run CodeceptJS via npx
task codeceptjs:docker         # Run CodeceptJS via Docker
task devsecops:test:bootstrap:infrastructure  # Bootstrap test infra
task devsecops:test:teardown:infrastructure   # Teardown test infra
```

### 📦 Release
```bash
task release                   # Run all release tasks
task devsecops:release:commitizen      # Bump version
task devsecops:release:push-release    # Push tags/commits
task docker-ce:push            # Push Docker image
```

### 🚀 Deploy
```bash
task deploy                    # Run all deploy tasks
task devsecops:deploy:bootstrap        # Deploy bootstrap (helm, sealed-secrets)
task helm:dependency:update    # Update Helm dependencies
task helm:package              # Package Helm chart
task kubeseal:seal             # Seal secrets
```

### 🔄 Operate
```bash
task operate                   # Run all operate tasks
```

### 📊 Monitor
```bash
task monitor                   # Run all monitor tasks
```

### 💭 Feedback
```bash
task feedback                  # Run all feedback tasks
```

### 🛠️ Development
```bash
task dev:setup-environment     # Setup dev environment
task dev:init:ci               # CI/CD initialization (CI-only)
task dev:reset                 # Destroy and cleanup
task devsecops:init            # Full project initialization (local)
task devsecops:init:prerequisites  # Check and install required prerequisites
task devsecops:init:template       # Scaffold or update project from template
task devsecops:init:configure      # Configure GitLab project settings
task lefthook:install          # Install git hooks
```

### 🐳 Docker
```bash
task docker-ce:install         # Install Docker via Ansible
task docker-ce:build           # Build image
task docker-ce:push            # Push to registry
task docker-ce:save            # Save image locally
```

### ☸️ Kubernetes
```bash
task k3d:create:cluster        # Create k3d cluster
task k3d:destroy:cluster       # Destroy k3d cluster
task kubectl:install           # Install kubectl
task helm:install              # Install Helm
task kubeseal:install          # Install kubeseal
```

### 📋 Copier Template
```bash
task copier                    # Copier operations
task copier:update             # Update from template
```

---

## Test Structure

### E2E Tests (CodeceptJS + Gherkin)

**Configuration**: `project/tests/e2e/codecept.conf.js`

**Features Location**: `project/tests/e2e/features/`

Features are organized by journey act: `01-install/` (installer, agent-mode, fresh machine, first-run help, and merge-request safety), `02-daily-work/` (protected commits, self-healing init, release window), and `03-evolution/` (Copier rendering matrix, renovate, toolbox update).

**Step Definitions**: `project/tests/e2e/support/steps/`

| File                   | Purpose                                     |
|------------------------|---------------------------------------------|
| `journey.js`           | Developer-journey steps (terminal + GitLab) |
| `init-baseline.js`     | devsecops:init effect steps                 |
| `init-guidance.js`     | init failure / opt-out guidance steps       |
| `release-toggle.js`    | task release protection-window steps        |
| `glab-auth-ensure.js`  | glab auth guidance steps                    |
| `template-matrix.js`   | Copier rendering matrix + update steps      |
| `betterleaks.js`       | Secret-scanning steps                       |
| `installer-prereqs.js` | Bare-machine prerequisite steps             |

**Helpers**: `project/tests/e2e/support/helpers/`

| File              | Purpose                                         |
|-------------------|-------------------------------------------------|
| `copierRender.js` | Copier render/update helpers                    |
| `gitlabApi.js`    | GitLab REST helpers                             |
| `docker.js`       | Container orchestration helpers                 |
| `textRender.js`   | Text-to-pixel proof helper                      |
| `pageVisual.js`   | Page visual assert + baseline regeneration mode |

### Test Execution
```bash
# Full test suite (coverage guards + e2e)
task test

# E2E suite only
task project:test:e2e

# With grep filter
task project:test:e2e -- --grep "@render-matrix"
```

---

## CI/CD Configuration

### GitLab CI

**Main file**: `.gitlab-ci.yml`

**Includes**:
- `.config/gitlab/ci/before_script.yml`
- `.config/gitlab/ci/cache.yml`
- `.config/gitlab/ci/services.yml`
- `.config/gitlab/ci/stages.yml`
- `.config/gitlab/ci/tags.yml`
- `.config/gitlab/ci/variables.yml`
- `.config/gitlab/ci/workflow.yml`
- `.config/gitlab/ci/devsecops/*.yml` (9 phase files)

**Base Image**: `registry.gitlab.com/digital-commons/devsecops/the-devsecops-toolbox:18.0.0`

### CI Variables Required

| Variable                | Purpose                                                         |
|-------------------------|-----------------------------------------------------------------|
| `TASK_COMMITIZEN_TOKEN` | Commitizen release token for Git push and branch-protection API |
| `GITLAB_USER_LOGIN`     | GitLab username (auto)                                          |
| `GITLAB_USER_EMAIL`     | GitLab email (auto)                                             |

---

## Conventions

### Naming
- **Task prefix**: `TASK_` for all environment variables
- **Phase tasks**: `devsecops:{phase}` (e.g., `devsecops:code`)
- **Tool tasks**: `{tool}:{action}` (e.g., `betterleaks:protect`)
- **Project tasks**: `project:{phase}` (e.g., `project:build`)

### Paths
- **Config files**: `.config/{tool}/`
- **Test features**: `project/plugin/tests/features/`
- **Test steps**: `project/plugin/tests/e2e/codeceptjs/step_definitions/`
- **Reports**: `megalinter-reports/`
- **Cache**: `.cache/`

### Jinja Templates
Files ending in `.jinja` are Copier templates:
- `Taskfile.yml.jinja` → `Taskfile.yml`
- `VERSION.jinja` → `VERSION`
- `CHANGELOG.md.jinja` → `CHANGELOG.md`

---

## Docker Services

| Service      | Dockerfile                               | Purpose         |
|--------------|------------------------------------------|-----------------|
| `ubuntu`     | `.config/devcontainer/ubuntu/Dockerfile` | DevContainer    |
| `codeceptjs` | `.config/codeceptjs/Dockerfile`          | E2E testing     |
| `kaniko`     | `.config/kaniko/Dockerfile`              | CI image builds |

### DevContainer (docker-compose.yml)
- **Image**: Ubuntu 24.04
- **Features**: Docker-in-Docker, host networking, privileged
- **Healthcheck**: `task --version`

---

## Security Tools Integrated

| Tool            | Purpose            | Config                            |
|-----------------|--------------------|-----------------------------------|
| **Betterleaks** | Secret scanning    | `.config/betterleaks/config.toml` |
| **MegaLinter**  | Multi-linter       | `.config/megalinter/config.yml`   |
| **Grype**       | Vulnerability scan | `.config/grype/config.yml`        |
| **Trivy**       | Container security | `.config/trivy/config.yml`        |
| **KICS**        | IaC security       | `.config/kics/config.yml`         |
| **DevSkim**     | Security linter    | `.config/devskim/config.json`     |
| **Lefthook**    | Git hooks          | `lefthook.yml`                    |

---

## Quality Tools Integrated

| Tool           | Purpose             | Config                          |
|----------------|---------------------|---------------------------------|
| **Commitlint** | Commit validation   | `.config/commitlint/config.yml` |
| **Commitizen** | Version bump        | `.config/commitizen/cz.yaml`    |
| **Lizard**     | Complexity analysis | Taskfile                        |
| **CSpell**     | Spell check         | `.config/cspell/config.json`    |
| **Prettier**   | Code formatting     | Auto-fix enabled                |
| **YAMLLint**   | YAML linting        | `.config/yamllint/config.yml`   |
