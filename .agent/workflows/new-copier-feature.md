---
description: Implement a new Copier template feature using TDD with Gherkin tests
---

# New Copier Feature Workflow

This workflow guides you through implementing a new Copier template feature using Test-Driven Development (TDD) with Gherkin/CodeceptJS tests.

## Prerequisites

- Understand the feature requirements
- Identify the domain and feature name for DDD organization
- Have a clear picture of the expected Copier question(s) and template changes

## Test Architecture

```text
project/tests/
├── features/{domain}/{feature}.feature  # Gherkin scenarios
├── step_objects/                        # Reusable logic (DO NOT ADD STEPS HERE)
│   ├── assertions.js                    # assertFileExists, assertFileContains, etc.
│   ├── commands.js                      # executeCopier, executeCommand, etc.
│   ├── config.js                        # getProjectRoot, slugify, etc.
│   ├── content.js                       # resolvePath + content steps
│   ├── copier.js                        # initTestContext + copier steps
│   ├── filesystem.js                    # removeDirRecursive, ensureDir, etc.
│   └── testContext.js                   # getCurrentTest, setCurrentTest
└── steps/                               # Gherkin step definitions
    ├── {domain}.js                      # Domain-specific steps
    └── system.js                        # Generic infrastructure steps
```

## Workflow Steps

### 1. Define the Feature (Gherkin)

Create a new feature file:

```bash
project/tests/features/{domain}/{feature}.feature
```

**Template:**
```gherkin
@copier @scaffolding @{domain} @{feature}
Feature: {Feature Title}
  As a DevSecOps engineer
  I want to {goal}
  So that {benefit}

  @default
  Scenario: {Default behavior scenario}
    Given a clean temporary directory for "{domain}/{feature}" tests
    When the copier command is executed with {option} "{default_value}"
    Then {expected outcome}

  @variant
  Scenario: {Alternative scenario}
    Given a clean temporary directory for "{domain}/{feature}" tests
    When the copier command is executed with {option} "{other_value}"
    Then {different expected outcome}

  @update
  Scenario: Update project from {A} to {B}
    Given a clean temporary directory for "{domain}/{feature}" tests
    And a project was generated with {option} "{A}"
    When the project is updated with {option} "{B}"
    Then {expected outcome after update}
```

**Rules:**
- NO Background block (prevents per-scenario folder creation)
- Use the generic step: `Given a clean temporary directory for "{domain}/{feature}" tests`
- Use parameterized steps with `{string}` for reusability
- Tags should be descriptive: `@default`, `@variant`, `@update`

### 2. Add Step Definitions

Create or update `project/tests/steps/{domain}.js`:

```javascript
/**
 * {Domain} Domain Steps
 *
 * Steps for testing {description}.
 */

const { resolvePath } = require('../step_objects/content')
const { executeCopier } = require('../step_objects/commands')
const { assertFileContains, assertFileNotContains } = require('../step_objects/assertions')

function register () {
  // Given
  Given('a project was generated with {option} {string}', function (value) { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { {option_key}: value })
  })

  // When
  When('the copier command is executed with {option} {string}', function (value) { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { {option_key}: value })
  })

  When('the project is updated with {option} {string}', function (value) { // eslint-disable-line no-undef
    executeCopier(this.projectRoot, { {option_key}: value }, { force: true })
  })

  // Then
  Then('{assertion description}', function () { // eslint-disable-line no-undef
    const filePath = resolvePath(this, '{path/to/file}')
    assertFileContains(filePath, '{expected_content}')
  })
}

// Auto-register when loaded by CodeceptJS
register()

module.exports = { register }
```

**IMPORTANT:** Add the new file to `codecept.conf.js`:

```javascript
gherkin: {
  steps: [
    // ... existing steps
    './steps/{domain}.js'  // ADD THIS LINE
  ]
}
```

### 3. Run Tests (Should Fail)

```bash
// turbo
task test -- --grep "@{feature}"
```

Verify tests fail with expected errors (missing files, wrong content, etc.)

### 4. Implement Copier Configuration

Edit `copier.yml`:

```yaml
# Questions
{option_key}:
  type: str
  help: {Help text for the user}
  choices:
    {Label 1}: {value_1}
    {Label 2}: {value_2}
  default: {default_value}
```

**Rules:**
- KISS: Only add options that are truly needed
- Use `choices` for limited, known options
- Provide sensible defaults
- Help text should be clear and concise

### 5. Create/Modify Jinja Templates

Create `.jinja` files for conditional content:

```jinja
---
# File header
{% if {option_key} == '{value_1}' %}
# Content for value_1
some_setting: enabled
{% endif %}
{% if {option_key} == '{value_2}' %}
# Content for value_2
some_setting: disabled
{% endif %}
```

**Rules:**
- Keep conditions simple
- Use `{% if %}` / `{% endif %}` blocks
- Rename static files from `.yml` to `.yml.jinja` if adding conditions

### 6. Run Tests (Should Pass)

```bash
// turbo
task test -- --grep "@{feature}"
```

All tests should now pass.

### 7. Run Full Test Suite

```bash
// turbo
task test
```

Ensure no existing tests were broken.

### 8. Verify Test Output Structure

Check that test folders are created correctly:

```bash
ls tmp/tests/{domain}/{feature}/
```

Expected structure:
```bash
tmp/tests/{domain}/{feature}/
├── {scenario-1-slug}/
├── {scenario-2-slug}/
└── {scenario-3-slug}/
```

### 9. Run Linters

```bash
// turbo
task code
```

Verify all linters pass. Fix any errors before committing. This command takes approximately 1 minute.

## Available Step Objects

### Assertions (`step_objects/assertions.js`)
- `assertFileExists(path, message)`
- `assertFileNotExists(path, message)`
- `assertFileContains(path, content)`
- `assertFileNotContains(path, content)`
- `assertDirExists(path, message)`
- `assertDirNotExists(path, message)`

### Commands (`step_objects/commands.js`)
- `executeCopier(projectRoot, data, options)` - Run copier with data options
- `executeCommand(cmd, options)` - Run shell command

### Content (`step_objects/content.js`)
- `resolvePath(context, ...parts)` - Resolve path relative to projectRoot

### Generic Steps (`steps/system.js`)
- `Given a clean temporary directory for "{domain}/{feature}" tests`

### Copier Steps (`step_objects/copier.js`)
- `Given a generated project for "{domain}/{feature}" tests`
- `Given a generated project from the Copier template`
- `When the copier command is executed with default settings`

## Constraints Checklist

- [ ] TDD: Tests written before implementation
- [ ] DDD: Feature file in correct domain folder
- [ ] KISS: No unnecessary options or complexity
- [ ] No Background block in feature file
- [ ] Steps are parameterized and reusable
- [ ] Domain steps file added to `codecept.conf.js`
- [ ] `register()` called and exported in step file
- [ ] All existing tests still pass
- [ ] Linters pass (`task code`)

## Reference Files

When creating new template files, use these existing files as reference for conventions:

- **Taskfile convention:** See `.config/megalinter/Taskfile.yml` for the expected format (variables with `TASK_` prefix, `summary` blocks, `status` conditions, etc.)
- **Install script convention:** See `.config/node/install.sh` for shell script conventions (shfmt/shellcheck compliant)

## Example: Ansible Integration Feature

**Domain:** `ansible`
**Feature:** `integration`

**Feature file:** `project/tests/features/ansible/integration.feature`
```gherkin
@copier @scaffolding @ansible
Feature: Ansible Optional Integration
  As a DevSecOps engineer
  I want to generate a project without Ansible integration
  So that I can use the DevSecOps toolbox in projects that don't require Ansible

  @default
  Scenario: Generate project without Ansible integration (default behaviour)
    Given a clean temporary directory for "ansible/integration" tests
    When the copier command is executed with default settings for Ansible
    Then the ".config/ansible" directory should NOT exist
```

**Steps file:** `project/tests/steps/ansible.js`
```javascript
const { resolvePath } = require('../step_objects/content')
const { executeCopier } = require('../step_objects/commands')
const { assertFileContains, assertFileNotContains } = require('../step_objects/assertions')

function register () {
  Given('a project was generated with Ansible enabled', function () {
    executeCopier(this.projectRoot, { ansible_enabled: true })
  })

  When('the copier command is executed with default settings for Ansible', function () {
    executeCopier(this.projectRoot)
  })

  Then('the Taskfile should include the Ansible taskfile reference', function () {
    const taskfilePath = resolvePath(this, 'Taskfile.yml')
    assertFileContains(taskfilePath, 'ansible:\n    taskfile: .config/ansible/Taskfile.yml')
  })
}

register()
module.exports = { register }
```
