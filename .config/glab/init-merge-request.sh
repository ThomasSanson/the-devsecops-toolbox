#!/usr/bin/env sh
# Deliver a framework change through a reviewable merge request.
#
# Branches FROM the default branch as GitLab holds it (regardless of the
# branch currently checked out), commits the working-tree changes onto it,
# pushes, and opens a merge request into the default branch. The merge request
# is left OPEN for review — the framework is never pushed straight to the
# default branch.
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
# Idempotent: re-uses the branch while it carries commits the default branch
# lacks, does not open a duplicate MR, and stops before pushing anything when
# there is nothing to propose.
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

# A release that changes lines the project edited too leaves the file with
# copier's conflict markers, marked unmerged: git then refuses to switch
# branches, and the update died here without a word. Stage it as it is, so both
# versions reach the review, and name the file.
conflicted="$(git diff --name-only --diff-filter=U)"
if [ -n "${conflicted}" ]; then
  printf '%s\n' "${conflicted}" | while IFS= read -r file; do
    printf '  ⚠️  %s: this release changed lines you had edited too. Both versions are kept between conflict markers: settle them before merging.\n' "${file}"
  done
  git add -A
fi

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

# The default branch as GitLab holds it: the local copy may lag behind it.
git fetch --quiet origin "+refs/heads/${DEFAULT_BRANCH}:refs/remotes/origin/${DEFAULT_BRANCH}"
BASE="origin/${DEFAULT_BRANCH}"

# Commits on the delivery branch that the default branch does not have yet are
# work in progress: the branch is re-used, never reset.
FROM="${BASE}"
if [ -n "$(git rev-list -n 1 "${BASE}..refs/heads/${MR_BRANCH}" 2>/dev/null)" ]; then
  FROM="${MR_BRANCH}"
fi

# Nothing to propose: no change in the working tree and no such commit. Stop
# before switching branches, so the developer's branch, and the ignore rules
# it carries, stay as they are.
if [ "${FROM}" = "${BASE}" ] && [ -z "$(git status --porcelain)" ]; then
  printf '  ✅ No framework changes to propose: %s on GitLab already has them. Nothing pushed, no merge request opened.\n' "${DEFAULT_BRANCH}"
  exit 0
fi

# Carry the working-tree changes onto the delivery branch: the one that already
# carries work, or a new one from the default branch (not from the current one).
if [ "${FROM}" = "${MR_BRANCH}" ]; then
  printf '  🔄 Preparing %s, keeping the commits already on it...\n' "${MR_BRANCH}"
  git checkout -q "${MR_BRANCH}"
else
  printf '  🔄 Preparing %s from %s...\n' "${MR_BRANCH}" "${DEFAULT_BRANCH}"
  git checkout -B "${MR_BRANCH}" "${BASE}" >/dev/null 2>&1 ||
    git checkout -B "${MR_BRANCH}" >/dev/null 2>&1
fi

git add -A
git diff --cached --quiet || git commit --no-verify -m "${MR_TITLE}" >/dev/null

git push -u origin "${MR_BRANCH}"

# GitLab registers a pushed branch in the background and refuses a merge
# request from it until then ("source_branch does not exist"): on a busy
# instance that takes a few seconds. Wait on the check GitLab itself runs, a
# minute at most, then let glab report whatever is still wrong.
branch_path="$(printf '%s' "${MR_BRANCH}" | sed 's|/|%2F|g')"
tries=0
until glab api --method HEAD "projects/:fullpath/repository/branches/${branch_path}" >/dev/null 2>&1; do
  tries=$((tries + 1))
  [ "${tries}" -lt 30 ] || break
  sleep 2
done

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
