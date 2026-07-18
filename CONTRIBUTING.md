# 👋 Contributing Guide

We're thrilled that you're interested in contributing to this project! 🎉 This document outlines the contribution process and conventions to follow when participating in the development of this repository using the DevSecOps Toolbox.

## 🔧️ Prerequisites

Before contributing, make sure you have:

- 👤 A GitLab or GitHub account
- 📚 Basic knowledge of Git
- `task` ([Task](https://taskfile.dev/)) - *task runner*
- 🐳 Docker (or Podman)

Other dependencies will be automatically installed by the development tasks (via `task dev:setup-environment`), including:
- Development tools
- Required CLI utilities
- Project-specific dependencies

## 🚀 Contribution Process

### 1. Clone the Repository

```bash
git clone https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox.git
cd the-devsecops-toolbox
```

### 2. Create a Branch for Your Changes

```bash
git checkout -b your-branch-name
```

Branch naming conventions:
- `feature/feature-name` : ✨ for new features
- `fix/fix-name` : 🐛 for bug fixes
- `docs/doc-name` : 📖 for documentation changes
- `ci/ci-change` : ⚙️ for CI/CD pipeline modifications
- `refactor/refactor-name` : ♻️ for code refactoring

### 3. Set Up Development Environment

To initialize the development environment:

```bash
task dev:setup-environment
```

or

```bash
task deploy
```

This command will deploy the project services.

### 4. Local Development

To run the complete DevSecOps pipeline locally (⏳ *this may take some time the first time*):

```bash
task devsecops
```

To run specific stages of the DevSecOps pipeline:

```bash
task plan       # Initial planning
task code       # Development and checks
task build      # Build with security checks
task test       # Run tests
# ... other stages
```

### 📝 5. Code Conventions

#### Commit Structure

This project uses **Commitizen** to standardize commit messages. Your commit messages **must** follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```text
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Commit Types:**
- `feat` : ✨ New feature
- `fix` : 🐛 Bug fix
- `docs` : 📖 Documentation change
- `style` : 🎨 Changes that do not affect code meaning (whitespace, formatting, etc.)
- `refactor` : ♻️ Code change that neither fixes a bug nor adds a feature
- `perf` : ⚡ Performance improvement
- `test` : ✅ Adding or correcting tests
- `build` : 📦 Changes affecting the build system or external dependencies
- `ci` : ⚙️ Changes to CI/CD files and scripts
- `chore` : 🧹 Other changes that don't modify src or test files
- `revert` : ⏪ Reverting a previous commit

To help follow these conventions, use the following command to commit your changes:

```bash
task commitizen
```

#### Code Style

- **General**: Follow the linting rules configured in MegaLinter
- **JavaScript/TypeScript**: Follow ESLint and Prettier conventions
- **Python**: Follow [PEP 8](https://www.python.org/dev/peps/pep-0008/) guidelines
- **YAML**: Use 2 spaces for indentation
- **Bash**: Follow [Shell Style Guide](https://google.github.io/styleguide/shellguide.html)

### ✅ 6. Tests

Before submitting your changes, run the complete test suite. These tests follow Test-Driven Development (TDD) principles as outlined in the DevSecOps guidelines.

```bash
# Runs the complete test suite
task test

# Runs specific test types
task test:tdd      # TDD tests only
```

Ensure that **all tests pass** before submitting your merge request.

> ⚠️ **IMPORTANT**: Following TDD principles is mandatory. Always write tests before implementing features.

### 📤 7. Submitting Changes

Once your changes are complete and tested:

```bash
git add .
task commitizen
git push -u origin your-branch-name
```

Then create a **Merge Request** (GitLab) or **Pull Request** (GitHub) on the repository platform.

### 👀 8. Code Review

Your merge/pull request will be reviewed by the project maintainers. Additional changes may be requested before acceptance. The code review process ensures:

- Code quality and standards are maintained
- Security best practices are followed
- Tests are properly implemented
- DevSecOps principles are respected

## ✨ DevSecOps Principles

When working with this repository, adhere to the following DevSecOps principles:

- 🔐 **Security First**: Integrate security at every step of the development cycle
- 🔄 **Automation**: Automate testing, deployment, and security checks when possible
- 💡 **Shift Left**: Find and fix issues as early as possible in the development process
- 📈 **Continuous Improvement**: Regularly review and improve the DevSecOps pipeline
- 📛 **Infrastructure as Code**: Manage all infrastructure through version-controlled code

## 🛠️ Project Architecture

Before contributing, familiarize yourself with the project structure:

- `.config/` : Tool-specific configurations
  - `devsecops/` : DevSecOps Toolbox configuration
  - `commitizen/` : Commit message standardization
  - `megalinter/` : Code quality and security scanning
  - `docker-ce/` : Docker configuration
  - And others...
- `.devcontainer/` : Development container configuration
- `docs/` : Additional documentation
  - `guidelines/` : DevSecOps guidelines and best practices
- `project/` : Project-specific customization
  - `Taskfile.yml` : Project tasks (prefixed `project:*`)
  - `tests/e2e/` : Unified E2E suite (CodeceptJS + Gherkin + visual regression)

### DevSecOps Pipeline Structure

The DevSecOps Toolbox implements a complete DevSecOps lifecycle through distinct stages:

1. 🎯 **Plan**: Initial planning and requirements
- Automated preparation tasks
- Issue tracking integration

2. 💻 **Code**: Development with integrated security
- Commitlint validation
- MegaLinter checks
- Code quality analysis

3. 🛠️ **Build**: Secure building process
- Docker image builds
- Container security scanning
- Dependency verification

4. 🧭 **Test**: Comprehensive testing approach
- Unit tests
- Integration tests
- Security testing

5. 💼 **Release**: Secure release management
- Version bumping
- Changelog generation
- Release artifact signing

6. 🚀 **Deploy**: Automated deployment
7. 🔄 **Operate**: Operational management
8. 📊 **Monitor**: Continuous monitoring

### Test-Driven Development Approach

This project follows Test-Driven Development (TDD) principles, as outlined in the DevSecOps guidelines. The approach can be summarized as:

```text
🔴 1. Write a Failing Test First
    commit type: test(scope): add failing test for new feature

🟢 2. Write Minimal Code to Pass
    commit type: feat(scope): implement minimal solution to pass test

🔵 3. Refactor While Keeping Tests Green
    commit type: refactor(scope): improve implementation while maintaining test
```

For writing tests, we use CodeceptJS with Gherkin (BDD) and Playwright.

The test directory structure groups scenarios by domain:

```text
project/tests/e2e/
├── codecept.conf.js      # CodeceptJS configuration (Playwright + VisualHelper + REST)
├── features/             # Gherkin feature files by journey act
│   ├── 01-install/       # installer, agent-mode, fresh machine, first-run help, merge-request safety
│   ├── 02-daily-work/    # protected commits, self-healing init, release window
│   └── 03-evolution/     # Copier rendering matrix, renovate, toolbox update
├── pages/                # GitLab Page Objects (masking for visual determinism)
├── support/
│   ├── helpers/          # docker, gitlabApi, copierRender, textRender, …
│   ├── steps/            # Gherkin step definitions
│   └── terminal/         # live xterm/ttyd capture engine
└── screenshots/base/     # Visual baselines (tolerance: 0)
```

When developing new features or fixing bugs, always follow the TDD cycle:

1. Write a failing test that demonstrates the expected behavior
2. Implement the minimal code needed to make the test pass
3. Refactor the code as needed while ensuring tests continue to pass

## 🔗️ Versioning

This project follows **Semantic Versioning (SemVer)** principles. Version numbers are managed automatically through Commitizen.

## ❓ Questions and Support

If you have questions or need help contributing:

1. 📖 Check the existing documentation in the `docs/` folder
2. 💬 [Create a work item](https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/work_items) describing your problem or question

## 👊 Continuous Improvement

We value continuous improvement and feedback. If you have suggestions for making the DevSecOps Toolbox better, please share them through issues or merge requests.

## 📖 Additional Resources

- [Task Documentation](https://taskfile.dev)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [MegaLinter Documentation](https://megalinter.io/)
- [DevSecOps Guidelines](docs/guidelines/DevSecOps.md)

## ©️ License

By contributing to this project, you agree that your contributions will be covered by the [European Union Public License (EUPL)](LICENSE).

---
🙏 Thank you for contributing to the DevSecOps Toolbox!
