#!/usr/bin/env bash
#
# ============================================================================
# Merge-request diff base — shared by the guards that read a merge request
# ============================================================================
#
# DESCRIPTION:
#   Both merge-request guards (storyboard-coverage, no-cheat) answer the same
#   question first: what did this merge request change? Getting that answer
#   wrong is how a gate fails OPEN — it sees an empty diff and announces there
#   is nothing to check. So the resolution lives here once, and both guards use
#   it: same base, same refusal, one place to fix.
#
#   Sourced, never executed:
#       source "$(dirname "${BASH_SOURCE[0]}")/diff-base.sh"
#
# ============================================================================

# The CI checkout belongs to another user than the one running the job, so git
# refuses it and answers "warning: Not a git repository" to EVERY command — the
# state that used to make a gate announce "nothing to check" and pass. Other
# jobs get this from the `dev:init:ci` bootstrap, which these guards deliberately
# skip to stay fast. Trust the tree for THIS process only: the env form adds no
# duplicate entry to a developer's global config and cannot race two runs
# (same idiom as .config/devsecops/Taskfile.release.yml).
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0="${PWD}"

# The base this merge request is measured against. The runner's clone does not
# always carry the base commit CI hands over: a merge-request pipeline fetches
# the merge-request ref, and that commit can sit outside it. `git diff
# <missing>...HEAD` then falls back to path mode and prints its usage — which,
# unnoticed, reads as "nothing changed". Fall back to the target branch:
# `<target>...HEAD` computes the merge base itself, which is exactly the
# comparison a guard wants.
resolve_diff_base() {
  local base="${BASE:-${CI_MERGE_REQUEST_DIFF_BASE_SHA:-origin/main}}"
  if ! git rev-parse --verify --quiet "${base}^{commit}" >/dev/null 2>&1; then
    local target="${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-main}"
    git fetch --quiet origin "+refs/heads/${target}:refs/remotes/origin/${target}" >/dev/null 2>&1 || true
    if git rev-parse --verify --quiet "origin/${target}^{commit}" >/dev/null 2>&1; then
      base="origin/${target}"
    fi
  fi
  printf '%s' "${base}"
}

# A `<Name>-exempt: <reason>` trailer in any commit of the range. Every waiver in
# this repository is visible: review reads the reason instead of guessing at it.
has_exempt_trailer() {
  git log "${2}..HEAD" --format='%B' 2>/dev/null | grep -qiE "^${1}-exempt:[[:space:]]*\S"
}
