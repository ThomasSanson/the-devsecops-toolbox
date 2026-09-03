#!/usr/bin/env sh
# Deliver a framework change through a reviewable merge request.
#
# Branches FROM the default branch (regardless of the branch currently checked
# out), commits the working-tree changes onto it, pushes, and opens a merge
# request into the default branch. The merge request is left OPEN for review —
# the framework is never pushed straight to the default branch.
#
# Two callers, one delivery: `devsecops:init` scaffolds the framework onto
# init-framework-devsecops, `devsecops:update` carries a toolbox release onto
# update-framework-devsecops. They differ only by the arguments below.
#
#   $1  branch to deliver on (default: init-framework-devsecops)
#   $2  commit message, also the merge-request title
#   $3  merge-request description
#   $4  "true" to commit on the CURRENT branch instead of branching, when the
#       developer is not standing on the default branch. An update asks for
#       this — a developer who ran it from their own branch expects the change
#       there. init never does: it always branches off the default branch,
#       whatever happens to be checked out.
#
# Idempotent: re-uses the branch if it exists and does not open a duplicate MR.
set -eu

DEFAULT_BRANCH="${TASK_GIT_DEFAULT_BRANCH:-main}"
MR_BRANCH="${1:-${TASK_DEVSECOPS_INIT_BRANCH:-init-framework-devsecops}}"
MR_TITLE="${2:-chore: initialize devsecops framework}"
MR_DESCRIPTION="${3:-Automated initialization of the DevSecOps Toolbox. Review and merge to adopt the pipeline (CI/CD, scanners, linters, tasks).}"
STAY_ON_BRANCH="${4:-false}"

git config --global --add safe.directory "${PWD}" 2>/dev/null || true

[ -n "$(git config user.email 2>/dev/null || true)" ] || git config user.email "devsecops-init@local"
[ -n "$(git config user.name 2>/dev/null || true)" ] || git config user.name "DevSecOps Init"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"

# Asked to stay, and standing somewhere else than the default branch: commit
# here. Branching off the default branch would carry the change away from the
# work it belongs to, and open a review nobody asked for.
if [ "${STAY_ON_BRANCH}" = "true" ] && [ "${CURRENT_BRANCH}" != "${DEFAULT_BRANCH}" ]; then
  git add -A
  if git diff --cached --quiet; then
    printf '  ✅ Nothing to commit on %s.\n' "${CURRENT_BRANCH}"
  else
    git commit --no-verify -m "${MR_TITLE}" >/dev/null
    printf '  ✅ Committed on %s — no merge request, you are not on %s.\n' "${CURRENT_BRANCH}" "${DEFAULT_BRANCH}"
  fi
  exit 0
fi

printf '  🔄 Preparing %s from %s...\n' "${MR_BRANCH}" "${DEFAULT_BRANCH}"

# Create the delivery branch from the DEFAULT branch (not the current one),
# carrying the working-tree changes onto it.
git checkout -B "${MR_BRANCH}" "${DEFAULT_BRANCH}" >/dev/null 2>&1 ||
  git checkout -B "${MR_BRANCH}" >/dev/null 2>&1

git add -A
if git diff --cached --quiet; then
  printf '  ✅ No framework changes to propose (already on %s).\n' "${DEFAULT_BRANCH}"
else
  git commit --no-verify -m "${MR_TITLE}" >/dev/null
fi

git push -u origin "${MR_BRANCH}"

# Open the merge request — idempotent (skip if one already exists for the branch).
existing_count="$(glab mr list --source-branch "${MR_BRANCH}" 2>/dev/null | grep -c "${MR_BRANCH}" || true)"
if [ "${existing_count:-0}" -gt 0 ]; then
  printf '  ✅ Merge request for %s already open.\n' "${MR_BRANCH}"
else
  glab mr create \
    --source-branch "${MR_BRANCH}" \
    --target-branch "${DEFAULT_BRANCH}" \
    --title "${MR_TITLE}" \
    --description "${MR_DESCRIPTION}" \
    --yes
  printf '  ✅ Opened merge request %s → %s.\n' "${MR_BRANCH}" "${DEFAULT_BRANCH}"
fi
