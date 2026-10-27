#!/usr/bin/env bash
#
# ============================================================================
# Deployment-only merge request — "may this job skip its work?"
# ============================================================================
#
# DESCRIPTION:
#   Shipping a version is often a merge request that changes a few lines: the
#   image tags in a deployment folder. Nothing a test could catch, and the test
#   suite still runs for many minutes while production waits.
#
#   A project names its deployment folders, or single files, in
#   TASK_DEVSECOPS_TEST_DEPLOY_PATHS. Legacy/local callers can ask this script;
#   current CI jobs use rules at pipeline creation. It answers "skip" (exit 0)
#   only when ALL of these hold:
#
#     - the setting names at least one folder or file (it is empty by default);
#     - this is a merge request pipeline (CI_MERGE_REQUEST_DIFF_BASE_SHA is set);
#     - git can compute what the merge request changes;
#     - every changed file is a named file or sits inside a named folder.
#
#   Anything else, and any doubt, exits 1: the job runs exactly as before.
#   A change to a test, to the code, to the pipeline or to this very setting
#   (.env.dist) is outside the deployment folders, so it always runs the job.
#
# USAGE:
#   bash check-deploy-only.sh [what]   # CI passes CI_MERGE_REQUEST_DIFF_BASE_SHA
#   what: the job's work, for its messages ('build job'; default: test suite)
#
# ENVIRONMENT VARIABLES:
#   TASK_DEVSECOPS_TEST_DEPLOY_PATHS  Space-separated folders or files, relative
#                                     to the repository root (e.g.
#                                     "project/kustomize project/argocd"). A
#                                     CI/CD variable wins;
#                                     otherwise read from .env, .env.dev then
#                                     .env.dist, the first one wins (as task).
#
# EXIT CODES:
#   0  Only deployment files changed: the job may skip its work
#   1  Run the job
#
# ============================================================================

set -uo pipefail

# shellcheck source=.config/devsecops/scripts/diff-base.sh
source "$(dirname "${BASH_SOURCE[0]}")/diff-base.sh"

# The job runs this before task loads the dotenv files, so read them here.
DEPLOY_PATHS="${TASK_DEVSECOPS_TEST_DEPLOY_PATHS:-$(sed -n 's/^TASK_DEVSECOPS_TEST_DEPLOY_PATHS=//p' .env .env.dev .env.dist 2>/dev/null | head -n 1 | tr -d "\"'")}"

WHAT="${1:-test suite}"

run_the_job() {
  echo "🧪 The ${WHAT} runs: $1"
  exit 1
}

[ -n "${DEPLOY_PATHS// /}" ] || run_the_job "TASK_DEVSECOPS_TEST_DEPLOY_PATHS is empty."
[ -n "${CI_MERGE_REQUEST_DIFF_BASE_SHA:-}" ] || run_the_job "this is not a merge request pipeline."

BASE="$(resolve_diff_base)"
# --no-renames: a file moved INTO a deployment folder still shows where it came
# from, so moving a test there cannot hide it.
changed="$(git diff --name-only --no-renames "${BASE}...HEAD" 2>/dev/null)" ||
  run_the_job "cannot compute the diff against ${BASE}."
[ -n "${changed}" ] || run_the_job "the merge request changes no file."

while IFS= read -r file; do
  inside=false
  for folder in ${DEPLOY_PATHS}; do
    case "${file}" in "${folder%/}" | "${folder%/}"/*) inside=true ;; esac
  done
  "${inside}" || run_the_job "${file} is outside the deployment folders (${DEPLOY_PATHS})."
done <<<"${changed}"

echo "⏭️  Only deployment files changed (${DEPLOY_PATHS}): the ${WHAT} is skipped."
