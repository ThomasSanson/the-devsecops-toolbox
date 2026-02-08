# Tests Documentation

This directory contains end-to-end tests for the DevSecOps Copier template.

## Architecture

```text
project/tests/
├── README.md
└── template/                 # Copier template tests
    ├── codecept.conf.js      # CodeceptJS configuration
    ├── entrypoint.js         # Test hooks (Before/After)
    ├── features/             # Gherkin feature files
    │   ├── ansible/
    │   ├── commitizen/
    │   ├── copier/
    │   ├── dependency-check/
    │   ├── dev/
    │   ├── devsecops/
    │   ├── docker/
    │   ├── git/
    │   ├── gitlab/
    │   ├── gitleaks/
    │   ├── glab/
    │   ├── kaniko/
    │   ├── kubectl/
    │   ├── kubeseal/
    │   ├── lefthook/
    │   ├── lizard/
    │   ├── megalinter/
    │   ├── podman/
    │   ├── project/
    │   ├── renovate/
    │   ├── sealed-secrets/
    │   └── yamllint/
    ├── step_objects/         # Reusable logic (helpers, assertions)
    │   ├── assertions.js     # File/directory assertions
    │   ├── commands.js       # Shell command execution
    │   ├── config.js         # Test configuration
    │   ├── content.js        # Content step definitions
    │   ├── copier.js         # Copier execution helpers
    │   ├── filesystem.js     # File system utilities
    │   ├── tables.js         # Gherkin table parsing
    │   └── testContext.js    # Test metadata tracking
    └── steps/                # Domain-specific Gherkin steps
        ├── ansible.js
        ├── commitizen.js
        ├── devsecops.js
        ├── docker.js
        ├── gitlab.js
        ├── glab.js
        ├── podman.js
        ├── renovate.js
        ├── system.js         # Generic infrastructure steps
        └── taskfile.js
```

## Conventions

### Step Objects vs Steps

| Folder          | Purpose                                    | Example                                    |
|-----------------|--------------------------------------------|--------------------------------------------|
| `step_objects/` | Reusable logic, helpers, assertions        | `executeCopier()`, `assertFileContains()`  |
| `steps/`        | Gherkin step definitions (Given/When/Then) | `Given('a project was generated with...')` |

### Generic Steps

The `steps/system.js` provides generic infrastructure steps:

```gherkin
# Format: "domain/feature"
Given a clean temporary directory for "ansible/integration" tests
Given a clean temporary directory for "gitlab/proxy" tests
Given a clean temporary directory for "docker/runtime" tests
```

### Adding New Tests

1. Create a feature file in `features/<domain>/<feature>.feature`
2. Add domain-specific steps in `steps/<domain>.js` if needed
3. Use generic steps from `system.js` for setup
4. Run tests with `task test`

## Running Tests

```bash
# Run all tests
task test

# Run tests with specific tag
task test -- --grep "@ansible"
```
