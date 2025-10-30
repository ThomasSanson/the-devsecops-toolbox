# ∞ The DevSecOps Plugin

<div align="center">

[![Project license](https://img.shields.io/badge/license-EUPL--1.2-blue.svg?style=flat-square)](LICENSE)
[![Made with Go-Task](https://img.shields.io/badge/Built%20with-Task-blue?style=flat-square)](https://taskfile.dev)
[![Powered by Docker](https://img.shields.io/badge/Powered%20by-Docker-2496ED?style=flat-square&logo=docker)](https://www.docker.com/)
[![Made with Copier](https://img.shields.io/badge/Made%20with-Copier-blue?style=flat-square)](https://copier.readthedocs.io)

</div>

<details open="open">
<summary>Table of Contents</summary>

- [∞ The DevSecOps Plugin](#-the-devsecops-plugin)
  - [About](#about)
    - [Key Features](#key-features)
    - [Built With](#built-with)
    - [Project Structure](#project-structure)
    - [Pipeline Stages](#pipeline-stages)
  - [Getting Started](#getting-started)
    - [Prerequisites](#prerequisites)
    - [Installation](#installation)
  - [Usage](#usage)
    - [Task Control](#task-control)
    - [Common Operations](#common-operations)
    - [Project Customization](#project-customization)
    - [Available Commands](#available-commands)
  - [Copier-First Configuration](#copier-first-configuration)
    - [Overview](#overview)
    - [Configuration Flow](#configuration-flow)
    - [DevSecOps Stages Configuration](#devsecops-stages-configuration)
    - [Quick Start with Copier-First](#quick-start-with-copier-first)
    - [Example Configurations](#example-configurations)
  - [Environment Variables](#environment-variables)
    - [Task Control Variables](#task-control-variables)
    - [GitLab CI/CD Variables](#gitlab-cicd-variables)
  - [Development Setup](#development-setup)
  - [Architecture](#architecture)
  - [Features](#features)
  - [Security](#security)
    - [Security Best Practices](#security-best-practices)
  - [Tips \& Troubleshooting](#tips--troubleshooting)
    - [MegaLinter CSpell Configuration Fix](#megalinter-cspell-configuration-fix)
  - [Contributing](#contributing)
  - [Contributors](#contributors)
  - [License](#license)

</details>

---

## About

The DevSecOps Plugin is a comprehensive toolset designed to streamline and enforce DevSecOps practices in your development workflow. It integrates various tools and best practices for continuous integration, security scanning, code quality analysis, and deployment automation.

### Key Features

- **Modular Architecture**: Each tool and component has its dedicated configuration in `.config/`
- **Task Abstraction**: All operations are abstracted through Taskfile.yml for consistency
- **Comprehensive Security**: Integrated security scanning and vulnerability assessment
- **Code Quality Assurance**: Automated linting, formatting, and complexity analysis
- **Standardised Workflow**: Enforced commit messages and code review processes
- **Containerised Development**: DevContainer support for consistent environments

### Built With

- [Task](https://taskfile.dev) - Task runner & build tool
- [Docker](https://www.docker.com/) - Containerization
- [MegaLinter](https://megalinter.io/) - Code quality & security scanning
- [Commitizen](https://commitizen.github.io/cz-cli/) - Commit message standardization
- [Lizard](https://github.com/terryyin/lizard) - Code complexity analysis
- [Grype](https://github.com/anchore/grype) - Vulnerability scanning
- [Trivy](https://github.com/aquasecurity/trivy) - Security scanner
- [Copier](https://copier.readthedocs.io) - Project templating and scaffolding

### Project Structure

```bash
.
├── .config/           # Tool-specific configurations
│   ├── bun/          # Bun package manager configuration
│   ├── commitizen/   # Commit message standardisation
│   ├── devsecops/   # DevSecOps pipeline stages
│   ├── docker-ce/   # Docker configuration
│   └── ...          # Other tool configurations
├── .devcontainer/    # Development container configuration
├── src/             # Source code
└── Taskfile.yml     # Task runner configuration
```

### Pipeline Stages

The plugin implements a complete DevSecOps lifecycle through distinct stages:

1. 🎯 **Plan**: Initial planning and setup
2. 💻 **Code**: Development with integrated security checks

- Commitlint validation
- MegaLinter checks
- Commitizen formatting
- Lizard code analysis

3. 🏗️ **Build**: Automated building with security

- Docker image builds
- Security scans

4. 🧪 **Test**: Comprehensive testing

- Docker tests
- Security testing

5. 📦 **Release**: Secure release management

- Version bumping
- Changelog generation

6. 🚀 **Deploy**: Automated deployment
7. 🔄 **Operate**: Operational management
8. 📊 **Monitor**: Continuous monitoring
9. 💭 **Feedback**: Continuous improvement

## Getting Started

### Prerequisites

Before using the DevSecOps Plugin, ensure you have the following installed:

- Git
- [pipx](https://pipx.pypa.io/) – to install Python CLI applications (e.g., Copier and uv)
- Taskfile as go-task ([installation guide](https://taskfile.dev/installation/))
- Docker or Docker Desktop 4.x or newer (for container support)
- Visual Studio Code (recommended)


### Installation

1. Install uv with pipx:

```bash
pipx install uv
# Ensure your shell PATH is updated (only needed once)
pipx ensurepath
```

2. Install Python 3.12 with uv:

```bash
uv python install 3.12
```

3. Install Copier with pipx:

```bash
pipx install copier
```

Note: pipx installs CLI tools in isolated environments, independent of any project virtual environments. This is expected and recommended.

4. Generate a new project using the template:

```bash
cd ~/workspace/path/to/your/new/project
```


```bash
copier copy -a .config/devsecops/.copier-answers.yml https://gitlab.com/digital-commons/devsecops/tools/the-devsecops-plugin.git .
```

Replace `/path/to/your/new/project` with your desired project location.
Use `.` to create in the current directory


4. Commit the plugin

```bash
task dev:up
git add .
git commit -m"feat(devsecops): init"
```

## Usage

### Task Control

The plugin uses Task for operation control. Configuration is managed through environment variables defined in `.env` or `.env.dist` files.

Copy the template file and customize as needed:
```bash
cp .env.dist .env
# Edit .env with your preferred settings
```

Key environment variables are automatically loaded by Task. See [`.env.dist`](.env.dist) for the complete list of available variables including:

- **Core Controls**: `TASK_FLAGS`, `TASK_SEPARATOR`
- **Component Controls**: Enable/disable individual tools (e.g., `TASK_MEGALINTER_ENABLED`, `TASK_DOCKER_CE_ENABLED`)
- **Pipeline Stage Controls**: Enable/disable DevSecOps stages (e.g., `TASK_DEVSECOPS_CODE_ENABLED`, `TASK_DEVSECOPS_BUILD_ENABLED`)

### Common Operations

1. **Setup Development Environment**:
  ```bash
  task dev:setup-environment
  ```

2. **Run Code Quality and Security Checks**:
  ```bash
  task devsecops:code
  ```

3. **Validate Code Quality**:
  ```bash
  task devsecops:code
  ```

4. **Create Release**:
  ```bash
  task devsecops:release
  ```

### Project Customization

The plugin is designed to be easily customizable for specific project needs. Each project can define its own tasks in `project/Taskfile.yml` following the same lifecycle stages:

```yaml
# project/Taskfile.yml
tasks:
  plan:
    desc: Run project-specific plan tasks
    cmds:
      - custom-planning-command

  code:
    desc: Run project-specific code tasks
    cmds:
      - npm test
      - custom-linting

  build:
    desc: Run project-specific build tasks
    cmds:
      - docker build -t myproject .

  # ... other stages (test, release, deploy, operate, monitor, feedback)
```

These project-specific tasks will be automatically integrated into the main pipeline while keeping the core DevSecOps features intact. This allows you to:

- Add your own build processes
- Integrate custom testing frameworks
- Include project-specific deployment steps
- Add custom monitoring solutions
- Implement project-specific security checks

### Available Commands

```bash
# Run the complete DevSecOps pipeline
task

# Run individual stages
task plan       # Initial planning
task code       # Development and checks
task build      # Build and security
task test       # Run tests
task release    # Handle releases
task deploy     # Deployment
task operate    # Operations
task monitor    # Monitoring
task feedback   # Feedback loop

# Run specific tools
task megalinter         # Code quality & security
task commitizen         # Manage commits
task docker-ce:test     # Docker tests
task lizard             # Code complexity analysis
task commitlint         # Commit message validation
```

## Copier-First Configuration

### Overview

The DevSecOps Plugin uses a **Copier-first** approach where the `copier.yml` file and its answers serve as the **single source of truth** for all project configuration.

**Key Principles:**
- ✅ Copier answers drive the 9 DevSecOps stages, tools, and CI/CD
- ✅ `.env.devsecops` is generated from answers
- ✅ Taskfiles read `.env.devsecops` (dotenv priority) to enable/disable tasks via `TASK_*_ENABLED`
- ✅ `.gitlab-ci.yml` is generated with conditional includes and Molecule matrix from answers
- ✅ No external dependencies (JSON Schema, CLI, etc.)

### Configuration Flow

```
copier.yml (questions)
    ↓
.config/devsecops/.copier-answers.yml (answers)
    ↓
    ├→ .env.devsecops.jinja → .env.devsecops
    │       ↓
    │   Taskfile.yml (dotenv: [".env.devsecops", ...])
    │       ↓
    │   TASK_*_ENABLED variables
    │
    └→ .gitlab-ci.yml.jinja → .gitlab-ci.yml
            ↓
        Conditional includes + Molecule matrix
```

### DevSecOps Stages Configuration

Each of the 9 stages can be enabled/disabled individually:

| Stage | Copier Variable | ENV Variable | Description |
|-------|----------------|--------------|-------------|
| Plan | `stages_plan_enabled` | `TASK_DEVSECOPS_PLAN_ENABLED` | Planning and design |
| Code | `stages_code_enabled` | `TASK_DEVSECOPS_CODE_ENABLED` | Code quality and security |
| Build | `stages_build_enabled` | `TASK_DEVSECOPS_BUILD_ENABLED` | Compilation and packaging |
| Test | `stages_test_enabled` | `TASK_DEVSECOPS_TEST_ENABLED` | Unit, integration, e2e tests |
| Release | `stages_release_enabled` | `TASK_DEVSECOPS_RELEASE_ENABLED` | Versioning and changelog |
| Deploy | `stages_deploy_enabled` | `TASK_DEVSECOPS_DEPLOY_ENABLED` | Deployment to registries |
| Operate | `stages_operate_enabled` | `TASK_DEVSECOPS_OPERATE_ENABLED` | Operational tasks |
| Monitor | `stages_monitor_enabled` | `TASK_DEVSECOPS_MONITOR_ENABLED` | Monitoring and observability |
| Feedback | `stages_feedback_enabled` | `TASK_DEVSECOPS_FEEDBACK_ENABLED` | Metrics and improvement |

### Quick Start with Copier-First

1. **Initialize or update project**:
   ```bash
   copier copy . /path/to/new/project
   # OR
   copier update
   ```

2. **Answer interactive questions** about stages, tools, and configuration

3. **Files generated automatically**:
   - `.env.devsecops` - Environment variables for Task
   - `.gitlab-ci.yml` - CI/CD with conditional stages

4. **Modify configuration anytime**:
   ```bash
   # Edit answers file
   vim .config/devsecops/.copier-answers.yml
   
   # Regenerate templates
   task devsecops:code:sync-templates
   ```

### Example Configurations

**Full Ansible Collection:**
```yaml
profile: ansible-collection
stages_code_enabled: true
stages_build_enabled: true
stages_test_enabled: true
stages_deploy_enabled: true
test_molecule_enabled: true
test_matrix_java_versions: ["17", "21"]
test_matrix_scenarios: ["default", "ha"]
deploy_galaxy_enabled: true
```

**Minimal CI:**
```yaml
profile: ansible-role
stages_code_enabled: true
stages_build_enabled: true
stages_test_enabled: true
code_gitleaks_enabled: true
code_megalinter_enabled: false
test_matrix_java_versions: ["17"]
test_matrix_scenarios: ["default"]
```

For detailed documentation, see [docs/guidelines/COPIER-FIRST.md](docs/guidelines/COPIER-FIRST.md)

## Environment Variables

### Task Control Variables
You can customize the behavior of the plugin by setting environment variables in your `.env` file.

**Setup:**
```bash
# Copy the template and customize
cp .env.dist .env
```

**Available Variables:**
All configuration variables are documented in [`.env.dist`](.env.dist). Key categories include:

- **Core Controls**: Basic task behavior and formatting
- **Component Controls**: Enable/disable individual tools (30+ available)
- **Pipeline Stage Controls**: Enable/disable DevSecOps lifecycle stages
- **Tool-Specific Configuration**: Settings for individual components

For the complete list of variables and their default values, see [`.env.dist`](.env.dist).

### GitLab CI/CD Variables
The following variables need to be configured in your GitLab CI/CD settings:

- `CZ_DEPLOY_KEY`: Base64 encoded SSH private key for git operations (required for releases)
- `GITLAB_USER_LOGIN`: Your GitLab username (automatically provided)
- `GITLAB_USER_EMAIL`: Your GitLab email (automatically provided)

## Development Setup

1. Clone the repository:
```bash
git clone https://gitlab.gitlab.com/digital-commons/devsecops/tools/the-devsecops-plugin.git
cd the-devsecops-plugin
```

2. Install Task:
```bash
sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d
```

3. Setup development environment:
```bash
task dev:setup-environment
```

4. Run the complete pipeline locally:
```bash
task devsecops
```

## Architecture

The plugin follows a modular architecture:

```bash
.
├── .config/                  # Tool configurations
│   ├── bun/                 # Bun runtime config
│   ├── commitizen/          # Commit message config
│   ├── devsecops/          # Pipeline stage definitions
│   │   ├── Taskfile.plan.yml
│   │   ├── Taskfile.code.yml
│   │   ├── Taskfile.build.yml
│   │   └── ...
│   ├── docker/             # Docker configuration
│   └── megalinter/         # Linting configuration
├── .devcontainer/          # Dev container setup
├── project/                # Project-specific tasks
│   └── Taskfile.yml       # Custom task definitions
└── Taskfile.yml           # Main task orchestration

Each project can extend the base functionality by adding custom tasks in project/Taskfile.yml,
which are automatically integrated into the main pipeline while preserving the core DevSecOps features.
```

## Features

- ♾️ **Automation**: Automated workflows for common DevSecOps tasks
- 🔄 **Modular Pipeline**: Clearly separated stages with individual configurations
- 🎛️ **Flexible Control**: Enable/disable features via environment variables
- 🔒 **Security-First**: Integrated security scanning at every stage
- 📊 **Quality Assurance**: Comprehensive code quality checks
- 🐳 **Container-Ready**: Full Docker integration
- 📝 **Standardization**: Enforced commit message formatting
- 🔍 **Monitoring**: Built-in monitoring capabilities
- 🚀 **Project Customization**: Extensible framework allowing projects to define custom tasks for each lifecycle stage
  🔌 **Plugin Architecture**: Clear separation between core DevSecOps features and project-specific implementations

## Security

The plugin implements multiple security measures:

- Automated vulnerability scanning with Grype and Trivy
- Code quality checks with MegaLinter
- Dependency scanning
- Container security analysis
- Secure configuration validation

### Security Best Practices

- Keep all dependencies updated
- Follow the principle of least privilege
- Use environment variables for sensitive data
- Regular security scans
- Code review enforcement

## Tips & Troubleshooting

### MegaLinter CSpell Configuration Fix

When encountering MegaLinter CSpell errors, you can quickly fix configuration issues by:

1. Copy the generated configuration file:
  ```bash
  cp megalinter-reports/.config/cspell/config.json .config/cspell/config.json
  ```

2. Review the differences between the files to understand what changed

3. Validate the configuration works correctly

4. Commit the updated configuration

This approach ensures your CSpell configuration stays in sync with MegaLinter's requirements and resolves most spelling check issues.

## Contributing

Please see our [Contributing Guide](CONTRIBUTING.md) for details on how to set up the development environment and contribute to the project.

## Contributors

- Thomas Sanson ([https://github.com/ThomasSanson](https://github.com/ThomasSanson))

## License

This project is distributed under the EUPL v1.2 license — see the [LICENSE](LICENSE) file for more details.
