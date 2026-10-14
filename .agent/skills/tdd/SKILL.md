---
name: tdd
description: Test-Driven Development workflow. Use when implementing new features or fixing bugs. Enforces RED-GREEN-REFACTOR cycle with mandatory test-first approach.
---

# Test-Driven Development

## When to use this skill

- Implementing new features
- Fixing bugs
- Any code change that affects behavior

## The TDD cycle

Run the nine steps of the table in [`AGENTS.md`](../../../AGENTS.md) (section Testing) IN ORDER.
The sections below explain them.

### 1. DEPLOY — Environment ready

```bash
task deploy
```

### 2. RED — Write failing test FIRST

1. **Create Gherkin feature** in `project/tests/e2e/features/{domain}/`
- Write in **en**
- Add unique `@tag`

2. **Create Page Object** if needed in `project/tests/e2e/pages/`

3. **Run test — IT MUST FAIL**

```bash
task test -- --grep "@my-tag"
```

> ❌ If test passes, the test is wrong!

4. **Prove the failure is real**

```bash
task devsecops:test:check:red-is-real -- @my-tag
```

### 3. GREEN — Minimal code to pass

1. Write ONLY code needed to pass
2. No extra features
3. No optimization

```bash
task test -- --grep "@my-tag"
```

> ✅ Test must pass now

### 4. REFACTOR — Clean the code

1. Remove duplication
2. Improve naming
3. Extract methods/classes
4. **Run test after EACH change**

```bash
task test -- --grep "@my-tag"
```

### 5. FINALIZE

```bash
task devsecops:code:verify  # Lint check
task devsecops:test:verify  # Whole suite
```

## Rules

- ❌ NEVER write code before the test
- ❌ NEVER modify test to hide failure
- ❌ NEVER skip REFACTOR phase
- ✅ ALWAYS verify test fails first (RED)
- ✅ ALWAYS run test after each refactor
- ✅ Features in **en**, with @tag
