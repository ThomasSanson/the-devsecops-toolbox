#!/usr/bin/env sh
# Deliver the scaffolded DevSecOps framework via a reviewable merge request.
#
# Branches `init-framework-devsecops` FROM the default branch (regardless of the
# branch currently checked out), commits the scaffolded working-tree changes
# onto it, pushes, and opens a merge request into the default branch. The MR is
# left OPEN for review — the framework is never pushed straight to the default
# branch.
#
# Idempotent: re-uses the branch if it exists and does not open a duplicate MR.
set -eu

DEFAULT_BRANCH="${TASK_GIT_DEFAULT_BRANCH:-main}"
INIT_BRANCH="${TASK_DEVSECOPS_INIT_BRANCH:-init-framework-devsecops}"

git config --global --add safe.directory "${PWD}" 2>/dev/null || true

[ -n "$(git config user.email 2>/dev/null || true)" ] || git config user.email "devsecops-init@local"
[ -n "$(git config user.name 2>/dev/null || true)" ] || git config user.name "DevSecOps Init"

printf '  🔄 Preparing %s from %s...\n' "${INIT_BRANCH}" "${DEFAULT_BRANCH}"

# Create the framework branch from the DEFAULT branch (not the current one),
# carrying the scaffolded working-tree changes onto it.
git checkout -B "${INIT_BRANCH}" "${DEFAULT_BRANCH}" >/dev/null 2>&1 ||
  git checkout -B "${INIT_BRANCH}" >/dev/null 2>&1

git add -A
if git diff --cached --quiet; then
  printf '  ✅ No framework changes to propose (already on %s).\n' "${DEFAULT_BRANCH}"
else
  git commit --no-verify -m "chore: initialize devsecops framework" >/dev/null
fi

git push -u origin "${INIT_BRANCH}"

# Open the merge request — idempotent (skip if one already exists for the branch).
existing_count="$(glab mr list --source-branch "${INIT_BRANCH}" 2>/dev/null | grep -c "${INIT_BRANCH}" || true)"
if [ "${existing_count:-0}" -gt 0 ]; then
  printf '  ✅ Merge request for %s already open.\n' "${INIT_BRANCH}"
else
  glab mr create \
    --source-branch "${INIT_BRANCH}" \
    --target-branch "${DEFAULT_BRANCH}" \
    --title "chore: initialize devsecops framework" \
    --description "Automated initialization of the DevSecOps Toolbox. Review and merge to adopt the pipeline (CI/CD, scanners, linters, tasks)." \
    --yes
  printf '  ✅ Opened merge request %s → %s.\n' "${INIT_BRANCH}" "${DEFAULT_BRANCH}"
fi
