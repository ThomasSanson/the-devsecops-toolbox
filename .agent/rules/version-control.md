

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

## Rationale

The user controls versioning. The agent writes code and runs tests. The user decides when and what to commit. No exceptions.
