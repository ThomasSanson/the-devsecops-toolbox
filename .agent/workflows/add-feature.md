---
description: Add functionality to an existing template feature
---

# Add Feature Workflow

This workflow guides you through adding new functionality to an **existing** template feature (e.g., adding a new option, extending an existing tool configuration).

For creating a **new** feature from scratch, use `/new-feature` instead.

## Prerequisites

- Identify the existing feature/domain to extend
- Understand what functionality needs to be added
- Check existing tests to understand current behavior

## Workflow Steps

### 1. Review Existing Feature

Before making changes, understand the current implementation:

```bash
# Check existing feature tests
ls project/tests/features/{domain}/

# Check existing step definitions
cat project/tests/steps/{domain}.js

# Check existing template files
ls .config/{domain}/
```

### 2. Add or Update Tests (TDD)

Add new scenarios to the existing feature file or create a new feature file:

**File:** `project/tests/features/{domain}/{feature}.feature`

```gherkin
  @new-functionality
  Scenario: {Description of new functionality}
    Given a clean temporary directory for "{domain}/{feature}" tests
    When the copier command is executed with {new_option} "{value}"
    Then {expected new outcome}
```

If needed, add new step definitions to `project/tests/steps/{domain}.js`.

### 3. Run Tests (Should Fail)

```bash
// turbo
task test -- --grep "@{domain}"
```

Verify the new tests fail as expected.

### 4. Implement Changes

Depending on what you're adding:

#### Adding a new Copier question

Edit `copier.yml`:

```yaml
{new_option}:
  type: str
  help: {Help text}
  default: {default_value}
```

#### Modifying existing templates

Edit the `.jinja` files in `.config/{domain}/` to handle the new option:

```jinja
{% if {new_option} == '{value}' %}
# New content
{% endif %}
```

#### Adding new template files

Create new files in `.config/{domain}/` following the existing conventions.

**Reference files:**
- Taskfile convention: See `.config/megalinter/Taskfile.yml`
- Install script convention: See `.config/node/install.sh`

### 5. Run Tests (Should Pass)

```bash
// turbo
task test -- --grep "@{domain}"
```

### 6. Run Full Test Suite

```bash
// turbo
task test
```

Ensure no existing tests were broken (non-regression).

### 7. Run Linters

```bash
// turbo
task code
```

Verify all linters pass. Fix any errors before committing. This command takes approximately 2 minutes.

**Tip for cspell errors:** If cspell reports unknown words, verify they are legitimate technical terms, then copy the updated config:

```bash
mv -f megalinter-reports/.config/cspell/config.json .config/cspell/config.json
```

## Key Differences from New Feature

| Aspect             | New Feature (`/new-feature`) | Add Feature (`/add-feature`) |
|--------------------|------------------------------|------------------------------|
| Domain steps file  | Create new file              | Update existing file         |
| `codecept.conf.js` | Add new entry                | No change needed             |
| Feature file       | Create new file              | Add scenarios or create new  |
| Template files     | Create full structure        | Extend existing structure    |

## Checklist

- [ ] Existing tests still pass before changes
- [ ] New tests added for new functionality
- [ ] Implementation follows existing patterns
- [ ] All tests pass (`task test`)
- [ ] All linters pass (`task code`)
