

# Version Control

## ⛔ ABSOLUTELY FORBIDDEN

- ❌ NEVER run `git add`
- ❌ NEVER run `git commit`
- ❌ NEVER run `git push`
- ❌ NEVER run `git merge`
- ❌ NEVER run `git rebase`
- ❌ NEVER run `git stash`
- ❌ NEVER run `git reset`
- ❌ NEVER run `git checkout` to switch branches
- ❌ NEVER run any git command that modifies the repository state

## ✅ ALLOWED (read-only)

- ✅ `git status` — check current state
- ✅ `git log` — read history
- ✅ `git diff` — see changes
- ✅ `git branch` — list branches
- ✅ `git show` — inspect commits

## ✅ ALLOWED (the phase tasks, and only them)

The tasks of the test-first cycle (`task devsecops:code:agent:red`, `:green`,
`:refactor` — see `.agent/workflows/ai-development-cycle.md`) run `git add -N`
and `git diff` on your behalf: `-N` is how a brand-new test file becomes visible
to `git diff`, and the diff is how the phase checks the work was really done.
Running those tasks is allowed. They commit nothing and push nothing.

The prohibition above is unchanged for everything else: you never run git
yourself.

## Rationale

The user controls versioning. The agent writes code and runs tests. The user decides when and what to commit. No exceptions.
