#!/usr/bin/env bash
#
# ============================================================================
# Release Branch-Lock Safety Checker
# ============================================================================
#
# DESCRIPTION:
#   The release temporarily opens push access to the default branch to push the
#   version commit, then re-locks it. Three invariants keep that door from being
#   left open:
#
#     1. A restore_branch_protection trap must fire on the way out. It must be
#        `trap ... EXIT` and NOTHING more: `task release` runs under go-task's
#        embedded shell (mvdan/sh), which rejects every signal name in a trap
#        ("INT: invalid signal specification") AND already runs the EXIT trap on
#        a kill — go-task catches SIGINT/SIGTERM/SIGHUP and drains the deferred
#        EXIT handler before dying. So naming signals both BREAKS the release
#        (exit 2) and is redundant; EXIT alone is the correct, working belt.
#     2. The CI belt must not hide its own failure. A `task ...lock... || true`
#        after_script swallows a failed re-lock and the job stays green.
#     3. Only one release may run at a time, or two concurrent releases race on
#        the protection state. That is what `resource_group: release` enforces.
#
#   This guard asserts all three across the release Taskfile (and its .jinja
#   twin when present) and the release CI job.
#
# USAGE:
#   bash check-release-lock.sh
#
# EXIT CODES:
#   0  Every invariant holds
#   1  At least one invariant is broken
#
# ============================================================================

set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

errors=0
fail() {
  echo -e "${RED}✗${NC} $1"
  errors=$((errors + 1))
}
pass() { echo -e "${GREEN}✓${NC} $1"; }

echo -e "${BLUE}🔒 Checking release branch-lock safety...${NC}"

# 1. A restore_branch_protection trap on EXIT must exist, and it must name NO
#    signals — go-task's shell rejects them (breaks the release) and runs the
#    EXIT trap on a kill anyway. The plain file ships downstream; the .jinja
#    twin is framework-only, checked when present.
release_taskfiles=(
  "$PROJECT_ROOT/.config/devsecops/Taskfile.release.yml"
  "$PROJECT_ROOT/.config/devsecops/Taskfile.release.yml.jinja"
)
for tf in "${release_taskfiles[@]}"; do
  [ -f "$tf" ] || continue
  rel="${tf#"$PROJECT_ROOT"/}"
  trap_line="$(grep -E 'trap[[:space:]]+restore_branch_protection' "$tf" || true)"
  trimmed="${trap_line#"${trap_line%%[![:space:]]*}"}"
  if [ -z "$trap_line" ]; then
    fail "$rel: no restore_branch_protection trap found"
    continue
  fi
  if ! echo "$trap_line" | grep -Eq '\bEXIT\b'; then
    fail "$rel: restore_branch_protection trap must fire on EXIT (got: $trimmed)"
  elif echo "$trap_line" | grep -Eq '\b(INT|TERM|HUP|SIGINT|SIGTERM|SIGHUP|KILL)\b|EXIT[[:space:]]+[0-9]'; then
    # go-task's mvdan/sh rejects "trap ... INT" ("invalid signal specification")
    # → release exits 2 on every run. EXIT alone works and covers kills.
    fail "$rel: trap names signals go-task's shell rejects and that break the release; use 'trap restore_branch_protection EXIT' only (got: $trimmed)"
  else
    pass "$rel: re-lock trap fires on EXIT (go-task drains it on kill signals too)"
  fi
done

# 2 & 3. The release CI job must not swallow the re-lock failure and must
#        serialize releases with a resource_group.
release_ci="$PROJECT_ROOT/.config/gitlab/ci/devsecops/release.yml"
if [ -f "$release_ci" ]; then
  rel="${release_ci#"$PROJECT_ROOT"/}"
  if grep -Eq 'lock-default-branch[[:space:]]*\|\|[[:space:]]*true' "$release_ci"; then
    fail "$rel: after_script re-lock is masked by '|| true' (a failed re-lock stays green)"
  else
    pass "$rel: after_script re-lock failure is not masked"
  fi
  if grep -Eq '^\s*resource_group:\s*release\b' "$release_ci"; then
    pass "$rel: resource_group: release serializes releases"
  else
    fail "$rel: missing 'resource_group: release' (concurrent releases can race the branch lock)"
  fi
else
  fail ".config/gitlab/ci/devsecops/release.yml not found"
fi

echo ""
if [ "$errors" -eq 0 ]; then
  echo -e "${GREEN}✅ Release branch-lock safety holds.${NC}"
  exit 0
else
  echo -e "${RED}❌ ${errors} release branch-lock invariant(s) broken.${NC}"
  exit 1
fi
