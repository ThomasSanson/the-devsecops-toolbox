# DevSecOps Plugin Configuration Guide

## Question Organization

The DevSecOps plugin questions are organized hierarchically by stages. When you run `copier`, questions are asked in this order:

### 1. Project Basics
- **project_name**: Name of your project
- **project_version**: Initial version
- **project_description**: Brief description

### 2. Technology Stack
- **stack_primary**: Main technology (ansible, python, nodejs, etc.)
- **stack_additional**: Additional technologies (optional)
- **Type-specific questions**: Only asked if relevant stack is selected
  - `ansible_type`: collection, role, or playbook
  - `python_type`: package, application, api, or cli
  - `nodejs_type`: application, api, library, or frontend

### 3. DevSecOps Stages Selection
Enable/disable stages based on your project needs:
- **stages_plan_enabled**: Planning and design
- **stages_code_enabled**: Code quality and security
- **stages_build_enabled**: Compilation and packaging
- **stages_test_enabled**: Testing (unit, integration, e2e)
- **stages_release_enabled**: Versioning and changelog
- **stages_deploy_enabled**: Deployment to registries
- **stages_operate_enabled**: Operational tasks
- **stages_monitor_enabled**: Monitoring and observability
- **stages_feedback_enabled**: Metrics and continuous improvement

### 4. Stage-Specific Configuration

#### Code Stage (only if `stages_code_enabled: true`)
- **code_gitleaks_enabled**: Secrets detection
- **code_commitizen_enabled**: Conventional commits
- **code_commitlint_enabled**: Commit message validation
- **code_megalinter_enabled**: Comprehensive linting
- **code_lizard_enabled**: Code complexity analysis
- **code_renovate_enabled**: Dependency updates

#### Build Stage (only if `stages_build_enabled: true`)
- **build_docker_enabled**: Docker image building
- **build_coverage_check_enabled**: Code coverage validation

#### Test Stage (only if `stages_test_enabled: true`)
- **test_unit_enabled**: Unit tests
- **test_integration_enabled**: Integration tests
- **test_e2e_enabled**: End-to-end tests

**Stack-specific test tools:**
- Ansible: `test_molecule_enabled`, `test_molecule_prefer_virtualenv`
- Python: `test_pytest_enabled`, `test_coverage_threshold`
- Node.js: `test_jest_enabled`

#### Release Stage (only if `stages_release_enabled: true`)
- **release_docker_push_enabled**: Push Docker images
- **release_default_branch**: Default branch for releases

#### Deploy Stage (only if `stages_deploy_enabled: true`)
- **deploy_registry_enabled**: Deploy to container registry
- **deploy_registry_type**: gitlab, docker, github, etc.
- **deploy_registry_auth**: Enable authentication

**Stack-specific deploy targets:**
- Ansible: `deploy_galaxy_enabled`
- Python: `deploy_pypi_enabled`
- Node.js: `deploy_npm_enabled`

### 5. Runner Configuration
- **runner_container_image**: CI/CD runner image
- **runner_docker_socket**: Mount Docker socket
- **runner_proxies_from_env**: Use proxy settings
- **runner_cache_enabled**: Enable caching
- **runner_artifacts_enabled**: Enable artifacts

## Important Notes

### Plugin vs Project Configuration

**The plugin should NOT ask about:**
- ❌ Java versions to test
- ❌ Molecule scenarios to run
- ❌ Specific database configurations
- ❌ Application-specific settings

**The plugin SHOULD ask about:**
- ✅ Which DevSecOps tools to enable
- ✅ Which stages to activate
- ✅ General tooling preferences (virtualenv vs uvx)
- ✅ CI/CD runner configuration

### Project-Specific Configuration

Project-specific settings like test matrices, environment-specific configurations, or application parameters should be defined in:
- `project/Taskfile.yml` for local tasks
- `.gitlab-ci.yml` custom jobs section for CI/CD matrices
- Project-specific configuration files

### Example: Molecule Test Matrix

Instead of asking "Which Java versions to test?" in the plugin, users should add their own matrix in `.gitlab-ci.yml`:

```yaml
molecule:test:matrix:
  stage: test
  parallel:
    matrix:
      - JAVA_VERSION: ["17", "21"]
        SCENARIO: ["default", "custom"]
  script:
    - task project:test:molecule SCENARIO=${SCENARIO}
```

This keeps the plugin generic and reusable across different projects.
