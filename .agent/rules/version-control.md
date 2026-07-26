

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

## ✅ ALLOWED (`task verify`, and only it)

`task verify` runs `git add -N` and `git diff` on your behalf: `-N` is how a
brand-new test file becomes visible to `git diff`, and the diff is how the
guard sees whether a check was switched off. Running it is allowed, and running
it is how you know you are done. It commits nothing and pushes nothing.

The prohibition above is unchanged for everything else: you never run git
yourself.

## Rationale

The user controls versioning. The agent writes code and runs tests. The user decides when and what to commit. No exceptions.
