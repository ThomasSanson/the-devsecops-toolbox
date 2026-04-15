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

detect_gitlab_host_from_remotes() {
  for remote_name in $(git remote 2>/dev/null); do
    remote_url="$(git remote get-url "$remote_name" 2>/dev/null || true)"
    [ -n "$remote_url" ] || continue

    remote_without_scheme="${remote_url#*://}"
    if [ "$remote_without_scheme" != "$remote_url" ]; then
      remote_url="$remote_without_scheme"
    fi

    remote_url="${remote_url#*@}"
    remote_host="${remote_url%%[:/]*}"
    case "$remote_host" in gitlabssh.*) remote_host="gitlab.${remote_host#gitlabssh.}" ;; esac

    if [ -n "$remote_host" ] && echo "$remote_host" | grep -qi "gitlab"; then
      echo "$remote_host"
      return 0
    fi
  done
  return 1
}

GITLAB_REMOTE_HOST="${GITLAB_HOST:-}"
if [ -z "$GITLAB_REMOTE_HOST" ]; then
  GITLAB_REMOTE_HOST="$(detect_gitlab_host_from_remotes || true)"
fi
if [ -z "$GITLAB_REMOTE_HOST" ]; then
  GITLAB_REMOTE_HOST=$(glab config get host 2>/dev/null || echo "gitlab.com")
fi
export GITLAB_HOST="$GITLAB_REMOTE_HOST"

PROJECT_PATH=$(git remote get-url origin 2>/dev/null || true)
PROJECT_PATH="${PROJECT_PATH#*://*/}"
PROJECT_PATH="${PROJECT_PATH#*:}"
PROJECT_PATH="${PROJECT_PATH%.git}"
if [ -n "$PROJECT_PATH" ]; then
  PROJECT_PATH_ENCODED=$(printf "%s" "$PROJECT_PATH" | jq -sRr @uri)
else
  echo "❌ Could not determine project path from git remote." >&2
  exit 1
fi

strip_glab_noise() {
  sed 's/}[^}]*$/}/'
}

check_permissions() {
  local perms project_lvl group_lvl
  perms=$(glab api "projects/${PROJECT_PATH_ENCODED}" 2>/dev/null | jq '.permissions')
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

  branch_data=$(glab api "projects/${PROJECT_PATH_ENCODED}/protected_branches/${BRANCH}" 2>/dev/null | strip_glab_noise) || {
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
glab api --method DELETE "projects/${PROJECT_PATH_ENCODED}/protected_branches/${BRANCH}" >/dev/null 2>&1 || true

echo "   🔒 Protecting branch '${BRANCH}' (merge=Maintainers, push=No one)..."
RESPONSE=$(glab api --method POST \
  "projects/${PROJECT_PATH_ENCODED}/protected_branches?name=${BRANCH}&merge_access_level=40&push_access_level=0" \
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
