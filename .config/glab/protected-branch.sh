#!/usr/bin/env bash
set -euo pipefail

# -------------------------------------------------------------------
# Protected Branch Configuration
#
# Configures the default branch with strict protection rules:
#   - merge_access_level=40 (Maintainers)
#   - push_access_level=0 (No one)
# -------------------------------------------------------------------

BRANCH="${TASK_GLAB_PROTECTED_BRANCH:-main}"

strip_glab_noise() {
  sed 's/}[^}]*$/}/'
}

check_permissions() {
  local perms project_lvl group_lvl
  perms=$(glab api projects/:id 2>/dev/null | jq '.permissions')
  project_lvl=$(echo "$perms" | jq -r '.project_access.access_level // 0')
  group_lvl=$(echo "$perms" | jq -r '.group_access.access_level // 0')

  if [ "$project_lvl" -lt 40 ] && [ "$group_lvl" -lt 40 ]; then
    echo "   ❌ Insufficient permissions (Maintainer or higher required, access_level>=40)"
    exit 1
  fi
  echo "   ✅ Permissions verified (Maintainer or higher)"
}

verify_protected_branch_state() {
  local branch_data merge_ok push_ok errors

  branch_data=$(glab api "projects/:id/protected_branches/${BRANCH}" 2>/dev/null | strip_glab_noise) || {
    echo "   ❌ Branch '${BRANCH}' is not protected"
    return 1
  }

  errors=0
  merge_ok=$(echo "$branch_data" | jq '[.merge_access_levels[] | select(.access_level == 40)] | length')
  if [ "$merge_ok" -lt 1 ]; then
    echo "   ❌ Allowed to merge: expected Maintainers (access_level=40), got: $(echo "$branch_data" | jq -c '.merge_access_levels')"
    errors=1
  else
    echo "   ✅ Allowed to merge: Maintainers"
  fi

  push_ok=$(echo "$branch_data" | jq '[.push_access_levels[] | select(.access_level == 0)] | length')
  if [ "$push_ok" -lt 1 ]; then
    echo "   ❌ Allowed to push: expected No one (access_level=0), got: $(echo "$branch_data" | jq -c '.push_access_levels')"
    errors=1
  else
    echo "   ✅ Allowed to push: No one"
  fi

  return $errors
}

echo "🔒 Protected Branch Configuration"
check_permissions

echo "   🔄 Resetting protection on branch '${BRANCH}'..."
glab api --method DELETE "projects/:id/protected_branches/${BRANCH}" >/dev/null 2>&1 || true

echo "   🔒 Protecting branch '${BRANCH}' (merge=Maintainers, push=No one)..."
RESPONSE=$(glab api --method POST \
  "projects/:id/protected_branches?name=${BRANCH}&merge_access_level=40&push_access_level=0" \
  2>/dev/null | strip_glab_noise)
if ! echo "$RESPONSE" | jq -e '.name' >/dev/null 2>&1; then
  echo "   ❌ Failed to protect branch: $RESPONSE"
  exit 1
fi

if verify_protected_branch_state; then
  echo "✅ Done! Protected branch '${BRANCH}' is configured."
else
  echo "   ❌ Branch '${BRANCH}' verification failed."
  exit 1
fi
