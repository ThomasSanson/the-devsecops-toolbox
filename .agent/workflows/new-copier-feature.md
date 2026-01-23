---
description: Implement a new Copier template feature using TDD with Gherkin tests
---

# New Copier Feature Workflow

This workflow guides you through implementing a new Copier template feature using Test-Driven Development (TDD) with Gherkin/CodeceptJS tests.

## Prerequisites

- Understand the feature requirements
- Identify the domain and feature name for DDD organization
- Have a clear picture of the expected Copier question(s) and template changes

## Workflow Steps

### 1. Define the Feature (Gherkin)

Create a new feature file following DDD structure:

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
    Given a clean temporary directory for {domain} {feature} tests
    When the copier command is executed with {option} "{default_value}"
    Then {expected outcome}

  @variant
  Scenario: {Alternative scenario}
    Given a clean temporary directory for {domain} {feature} tests
    When the copier command is executed with {option} "{other_value}"
    Then {different expected outcome}

  @update
  Scenario: Update project from {A} to {B}
    Given a clean temporary directory for {domain} {feature} tests
    And a project was generated with {option} "{A}"
    When the project is updated with {option} "{B}"
    Then {expected outcome after update}
```

**Rules:**
- NO Background block (prevents per-scenario folder creation)
- Each scenario has its own `Given a clean temporary directory` step
- Use parameterized steps with `{string}` for reusability
- Tags should be descriptive: `@default`, `@variant`, `@update`

### 2. Add Step Definitions

#### given.js
```javascript
// {Domain} {Feature} specific
Given('a clean temporary directory for {domain} {feature} tests', function () {
  initTestContext(this, '{domain}', '{feature}')
})

Given('a project was generated with {option} {string}', function (value) {
  executeCopier(this.projectRoot, { {option_key}: value })
})
```

#### when.js
```javascript
When('the copier command is executed with {option} {string}', function (value) {
  executeCopier(this.projectRoot, { {option_key}: value })
})

When('the project is updated with {option} {string}', function (value) {
  executeCopier(this.projectRoot, { {option_key}: value }, { force: true })
})
```

#### then.js
```javascript
Then('{assertion description}', function () {
  const filePath = resolvePath(this, '{path/to/file}')
  assertFileContains(filePath, '{expected_content}')
  // or assertFileNotContains, assertFileExists, assertDirExists, etc.
})
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
├── {scenario-3-slug}/
└── {scenario-4-slug}/
```

Folder names should match slugified scenario names (without tags).

## Constraints Checklist

- [ ] TDD: Tests written before implementation
- [ ] DDD: Feature file in correct domain folder
- [ ] KISS: No unnecessary options or complexity
- [ ] No Background block in feature file
- [ ] Steps are parameterized and reusable
- [ ] Scenario names are descriptive and unique
- [ ] Test folders match scenario slugs
- [ ] All existing tests still pass

## Example: GitLab CI Tags Feature

**Domain:** `gitlab`
**Feature:** `tags`

**Question:**
```yaml
ci_platform:
  type: str
  help: Which GitLab environment are you using?
  choices:
    GitLab SaaS (gitlab.com): gitlab_saas
    GitLab Self-Hosted: gitlab_self_hosted
  default: gitlab_saas
```

**Template condition:**
```jinja
{% if ci_platform == 'gitlab_saas' %}
    - saas-linux-medium-amd64
{% endif %}
```

**Test structure:**
```bash
tmp/tests/gitlab/tags/
├── generate-project-for-gitlab-self-hosted/
├── generate-project-with-gitlab-saas-tags-default/
├── update-project-from-gitlab-saas-to-self-hosted/
└── update-project-from-self-hosted-to-gitlab-saas/
```
