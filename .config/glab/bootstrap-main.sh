#!/usr/bin/env sh
# Ensure the repository has a default branch with at least one commit.
#
# A freshly created/cloned GitLab project can be empty (no commits, unborn
# HEAD). Downstream GitLab configuration (protected branch, merge settings) and
# the init-framework-devsecops merge request all need the default branch to
# exist with a commit. This bootstraps it with a minimal README so the default
# branch stays clean — the framework itself is delivered via the merge request,
# not committed here.
#
# Idempotent: a no-op when the repository already has commits.
set -eu

DEFAULT_BRANCH="${TASK_GIT_DEFAULT_BRANCH:-main}"

git config --global --add safe.directory "${PWD}" 2>/dev/null || true

# The delivery flow below pushes to origin: require a GitLab-looking remote
# first (same detection/normalization as glab:auth:ensure, honoring the
# GITLAB_HOST override) so a foreign remote (github.com, …) gets actionable
# guidance instead of a raw git push failure.
if [ -z "${GITLAB_HOST:-}" ]; then
  remote_host="$(git remote get-url origin 2>/dev/null || true)"
  remote_host="${remote_host#*://}"
  remote_host="${remote_host#*@}"
  remote_host="${remote_host%%[:/]*}"
  case "${remote_host}" in gitlabssh.*) remote_host="gitlab.${remote_host#gitlabssh.}" ;; esac
  if ! printf '%s' "${remote_host}" | grep -qi "gitlab"; then
    printf '❌ No GitLab repository remote was detected.\n'
    printf '\n'
    printf 'Align your repository remote, then rerun:\n'
    printf '  git remote set-url origin https://gitlab.com/<namespace>/<project>.git\n'
    printf '  task devsecops:init\n'
    exit 1
  fi
fi

# Already has commits -> nothing to bootstrap (silent no-op, so the init output
# of repos that already have a default branch is unchanged).
if git rev-parse --verify HEAD >/dev/null 2>&1; then
  exit 0
fi

printf '  🔄 Bootstrapping %s with an initial commit...\n' "${DEFAULT_BRANCH}"

# Set a fallback identity ONLY when none is configured (never override the user's).
[ -n "$(git config user.email 2>/dev/null || true)" ] || git config user.email "devsecops-init@local"
[ -n "$(git config user.name 2>/dev/null || true)" ] || git config user.name "DevSecOps Init"

# Land on the default branch (handles an unborn HEAD named master/other).
git checkout -B "${DEFAULT_BRANCH}" >/dev/null 2>&1 || true

# Minimal README so the default branch has content WITHOUT the framework files
# (those remain untracked and are proposed via the merge request afterwards).
if [ ! -f README.md ]; then
  printf '# %s\n' "${PWD##*/}" >README.md
fi

git add README.md
# --no-verify: this bootstrap commit must not be gated by the hooks init just
# installed (lefthook/commitlint/gitleaks); the message is conventional anyway.
git commit --no-verify -m "chore: initialize repository" >/dev/null
git push -u origin "${DEFAULT_BRANCH}"

printf '  ✅ %s initialized and pushed.\n' "${DEFAULT_BRANCH}"
