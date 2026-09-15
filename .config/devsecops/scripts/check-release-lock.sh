#!/usr/bin/env bash
#
# ============================================================================
# Release Branch-Lock Safety Checker
# ============================================================================
#
# DESCRIPTION:
#   The release temporarily opens push access to the default branch to push the
#   version commit, then re-locks it. Four invariants keep that door from being
#   left open, and keep the push from happening too early:
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
#     4. The push comes LAST. A release cuts a version locally, publishes the
#        image for it, and only then pushes the tag and the version commit. The
#        push is the step that cannot be taken back: done first, any later
#        failure (a flaky download inside the image build is enough) leaves a
#        tag naming an image the registry does not have, the default branch
#        pointing at it, and no retry able to get past the tag — issue #221,
#        seen for real on 23.0.54. So `default:` must run `push-release` (bump,
#        nothing pushed), then `:project:release` (build and publish), then
#        `push`, and `push-release:` must contain no `git push` of its own.
#
#   This guard asserts all four across the release Taskfile (and its .jinja
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

# 4. The push comes last: bump locally, publish the image, THEN push. Checked by
#    line order in `default:` — `- task: push$` matches only the bare push task,
#    never `push-release` — plus the absence of any `git push` inside
#    `push-release:` itself. The `:project:release` line is optional: the .jinja
#    twin wraps it in a `project_enabled` conditional, so a generated project
#    without the project workspace has only the two release tasks.
for tf in "${release_taskfiles[@]}"; do
  [ -f "$tf" ] || continue
  rel="${tf#"$PROJECT_ROOT"/}"
  prepare_line="$(grep -nE -- '- task: push-release$' "$tf" | head -1 | cut -d: -f1 || true)"
  publish_line="$(grep -nE -- '- task: :project:release$' "$tf" | head -1 | cut -d: -f1 || true)"
  push_line="$(grep -nE -- '- task: push$' "$tf" | head -1 | cut -d: -f1 || true)"
  if [ -z "$prepare_line" ] || [ -z "$push_line" ]; then
    fail "$rel: the release must cut the version (push-release) and push it (push) as two separate tasks"
  elif [ "$push_line" -lt "$prepare_line" ]; then
    fail "$rel: the release pushes (line $push_line) before cutting the version (line $prepare_line)"
  elif [ -n "$publish_line" ] && { [ "$publish_line" -lt "$prepare_line" ] || [ "$publish_line" -gt "$push_line" ]; }; then
    fail "$rel: the image must be published (:project:release, line $publish_line) between the version bump (line $prepare_line) and the push (line $push_line)"
  else
    pass "$rel: the push comes after the image is published (nothing pushed for an image that does not exist)"
  fi
  push_release_body="$(awk '/^  push-release:/ {found = 1; next} /^  [a-zA-Z]/ {if (found) exit} found' "$tf")"
  if echo "$push_release_body" | grep -qE '^\s*git push'; then
    fail "$rel: push-release: pushes to the remote; the push belongs in the push: task, after the image is published"
  else
    pass "$rel: push-release: pushes nothing to the remote"
  fi
done

echo ""
if [ "$errors" -eq 0 ]; then
  echo -e "${GREEN}✅ Release branch-lock safety holds.${NC}"
  exit 0
else
  echo -e "${RED}❌ ${errors} release branch-lock invariant(s) broken.${NC}"
  exit 1
fi
