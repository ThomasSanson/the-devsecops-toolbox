# 🧰 The DevSecOps Toolbox

<div align="center">

[![Project license](https://img.shields.io/badge/license-EUPL--1.2-blue.svg?style=flat-square)](LICENSE)
[![Made with Go-Task](https://img.shields.io/badge/Built%20with-Task-blue?style=flat-square)](https://taskfile.dev)
[![Powered by Docker](https://img.shields.io/badge/Powered%20by-Docker-2496ED?style=flat-square&logo=docker)](https://www.docker.com/)
[![Made with Copier](https://img.shields.io/badge/Made%20with-Copier-blue?style=flat-square)](https://copier.readthedocs.io)

</div>

<details open="open">
<summary>Table of Contents</summary>

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
- [Environment Variables](#environment-variables)
- [Development Setup](#development-setup)
- [Architecture](#architecture)
- [Features](#features)
- [Security](#security)
  - [Security Best Practices](#security-best-practices)
- [Contributing](#contributing)
- [Contributors](#contributors)
- [License](#license)

</details>

---

## About

The DevSecOps Toolbox is a comprehensive toolset designed to streamline and enforce DevSecOps practices in your development workflow. It integrates various tools and best practices for continuous integration, security scanning, code quality analysis, and deployment automation.

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
├── project/         # Project-specific customization
│   ├── Taskfile.yml # Project tasks (prefixed `project:*`)
│   └── tests/       # Template tests (CodeceptJS + Gherkin)
└── Taskfile.yml     # Task runner configuration
```

Each e2e journey scenario is documented by a **storyboard**: one SVG in
[`project/tests/e2e/storyboards/`](project/tests/e2e/storyboards/) telling the
whole journey card by card — one Gherkin sentence = one card = one pixel
baseline. Open it locally in a browser (the surrounding text, including the
command that replays the scenario, is selectable); see
[`project/tests/README.md`](project/tests/README.md) for the full recipe.

### Pipeline Stages

The Toolbox implements a complete DevSecOps lifecycle through distinct stages:

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

The recommended one-liner installer needs only:

- Git
- `curl` (to fetch the installer)
- Docker or Docker Desktop 4.x or newer (for container support)

It installs `task` and `uv` for you. The tools below are only required for the manual "Standard installation" path further down:

- [pipx](https://pipx.pypa.io/) – to install Python CLI applications (e.g., Copier and uv)
- Taskfile as go-task ([installation guide](https://taskfile.dev/installation/))
- Visual Studio Code (recommended)


### Installation

From your project directory, run:

```bash
curl -fsSL https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/raw/main/.config/devsecops/install.sh | bash
```

That's it. The installer sets up `task`, `uv`, scaffolds your project with Copier, and runs the initial configuration.

> **Trying it locally, without GitLab?** The initial configuration targets GitLab (auth, protected branches, project access tokens, the init merge request), so on a bare local repo it will otherwise drop into an interactive `glab` login. Disable that step to scaffold and explore the project offline:
>
> ```bash
> curl -fsSL https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/raw/main/.config/devsecops/install.sh | TASK_GLAB_ENABLED=false bash
> ```
>
> **🔒 Security:** Review the script before executing it:
>
> ```bash
> curl -fsSL https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/raw/main/.config/devsecops/install.sh | less
> ```
>
> **New project?** Create a git repository first:
>
> ```bash
> mkdir my-project && cd my-project && git init
> ```
>
> **⚠️ PATH:** After installation, add `$HOME/.local/bin` to your `PATH` if not already present:
>
> ```bash
> export PATH="$HOME/.local/bin:$PATH"  # add to .bashrc or .zshrc
> ```

#### Standard installation

1. Install uv with pipx:

```bash
pipx install uv
# Ensure your shell PATH is updated (only needed once)
pipx ensurepath
```

2. Install the declared Python version with uv:

```bash
uv python install "$(cat .config/python/.python-version)"
```

The toolbox Python source of truth is `.config/python/.python-version`.

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
copier copy --trust -a .config/devsecops/.copier-answers.yml https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox.git .
```

Replace `/path/to/your/new/project` with your desired project location.
Use `.` to create in the current directory


5. Commit the toolbox and start the pipeline:

```bash
git add .
git commit -m "feat(devsecops): init"
task          # Show available tasks
task code     # Run linters
task test     # Run tests
```

## Usage

### Task Control

The toolbox uses Task for operation control. Configuration is managed through environment variables defined in `.env` or `.env.dist` files.

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
  task code
  ```

3. **Run the Test Suite**:
  ```bash
  task test
  ```

4. **Create Release**:
  ```bash
  task release
  ```

### Project Customization

The toolbox is designed to be easily customizable for specific project needs. Each project can define its own tasks in `project/Taskfile.yml` following the same lifecycle stages:

```yaml
# project/Taskfile.yml
tasks:
  plan:
    desc: Run project-specific plan tasks
    cmds:
      - custom-planning-command

  project:code:
    desc: Run project-specific code tasks
    cmds:
      - echo "Add your project linting here"

  project:build:
    desc: Run project-specific build tasks
    cmds:
      - echo "Add your project build here"

  # ... other stages (test, release, deploy, operate, monitor, feedback)
```

These project-specific tasks will be automatically integrated into the main pipeline while keeping the core DevSecOps features intact. This allows you to:

- Add your own build processes
- Integrate custom testing frameworks
- Include project-specific deployment steps
- Add custom monitoring solutions
- Implement project-specific security checks

### Updating the framework

A toolbox release normally arrives on its own: Renovate opens a merge request that runs `task copier:update`, and review decides.

`task devsecops:update` is the same thing asked for by hand — for a project without Renovate, for the day Renovate is broken, or simply to get the release now. It applies the release with the answers already stored in `.config/devsecops/.copier-answers.yml`, then delivers it the way the installer delivers the framework: a branch, a commit, and a merge request left open for review. Standing on your own branch instead, the change is committed there and no merge request is opened.

It refuses to run on a dirty working tree, because it commits what it changed.

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

# Move to a new toolbox release, delivered as a merge request
task devsecops:update

# Run specific tools
task megalinter         # Code quality & security
task commitizen         # Manage commits
task docker-ce:test     # Docker tests
task lizard             # Code complexity analysis
task commitlint         # Commit message validation
```

## Environment Variables

### Task Control Variables
You can customize the behavior of the toolbox by setting environment variables in your `.env` file.

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

- `TASK_COMMITIZEN_TOKEN`: Project access token used by release push/protection workflow (managed by `task devsecops:init`)
- `GITLAB_USER_LOGIN`: Your GitLab username (automatically provided)
- `GITLAB_USER_EMAIL`: Your GitLab email (automatically provided)

## Development Setup

1. Clone the repository:
```bash
git clone https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox.git
cd the-devsecops-toolbox
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

If `task devsecops:init` reports missing prerequisites, recover with:
```bash
task devsecops:init:prerequisites
```
This command installs missing tools and verifies the environment.

## Architecture

The toolbox follows a modular architecture:

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
  🔌 **Toolbox Architecture**: Clear separation between core DevSecOps features and project-specific implementations

## Security

The toolbox implements multiple security measures:

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

When CSpell flags a word that is legitimate for your project, add it to your project dictionary — never overwrite the framework file:

1. Add the word(s) to the `words` array in `.config/cspell/config.project.json` (your project's own list, kept across toolbox updates):
  ```json
  {
    "version": "0.2",
    "words": ["widget", "payload"]
  }
  ```

2. Re-run `task code` to confirm CSpell passes.

Do not edit or overwrite `.config/cspell/config.json`: it is a framework-managed wiring file (marked "DO NOT EDIT by hand") and any change is lost on the next `task copier:update`.

## Contributing

Please see our [Contributing Guide](CONTRIBUTING.md) for details on how to set up the development environment and contribute to the project.

## Contributors

- Thomas Sanson ([https://github.com/ThomasSanson](https://github.com/ThomasSanson))

## License

This project is distributed under the EUPL v1.2 license — see the [LICENSE](LICENSE) file for more details.
