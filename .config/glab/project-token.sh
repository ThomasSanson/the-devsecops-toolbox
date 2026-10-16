#!/usr/bin/env bash
set -euo pipefail

# Disable xtrace to prevent leaking tokens in CI logs.
set +x

TOKEN_NAME="${TASK_GLAB_PROJECT_TOKEN_NAME:-}"
TOKEN_PROTECTED="${TASK_GLAB_PROJECT_TOKEN_PROTECTED:-true}"
TOKEN_FORCE="${TASK_GLAB_PROJECT_TOKEN_FORCE:-false}"
TOKEN_ACCESS_LEVEL="${TASK_GLAB_PROJECT_TOKEN_ACCESS_LEVEL:-40}"
TOKEN_SCOPES="${TASK_GLAB_PROJECT_TOKEN_SCOPES:-api}"
TOKEN_LABEL="${TASK_GLAB_PROJECT_TOKEN_LABEL:-Project token}"

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

if [ -z "$TOKEN_NAME" ]; then
  echo "❌ TASK_GLAB_PROJECT_TOKEN_NAME is required." >&2
  exit 1
fi

if ! [[ "$TOKEN_ACCESS_LEVEL" =~ ^[0-9]+$ ]]; then
  echo "❌ TASK_GLAB_PROJECT_TOKEN_ACCESS_LEVEL must be numeric." >&2
  exit 1
fi

if EXPIRES_AT=$(date -v +90d +%Y-%m-%d 2>/dev/null); then
  :
else
  EXPIRES_AT=$(date -d '+90 days' +%Y-%m-%d)
fi

strip_glab_noise() {
  sed 's/}[^}]*$/}/'
}

scopes_to_json() {
  local raw="$1"
  local result
  result=$(
    printf '%s\n' "$raw" |
      tr ',' '\n' |
      sed 's/^[[:space:]]*//;s/[[:space:]]*$//' |
      sed '/^$/d' |
      jq -R . |
      jq -s .
  )
  if [ "$result" = "[]" ]; then
    echo "❌ TASK_GLAB_PROJECT_TOKEN_SCOPES produced an empty scope set." >&2
    exit 1
  fi
  echo "$result"
}

store_ci_variable() {
  local var_name="$1"
  local protected="$2"
  local api_response token_value payload result var_check

  api_response=$(cat)
  token_value=$(echo "$api_response" | strip_glab_noise | jq -r '.token // empty')
  if [ -z "$token_value" ]; then
    echo "   ❌ No token value found in API response"
    return 1
  fi

  var_check=$(glab api "projects/${PROJECT_PATH_ENCODED}/variables/${var_name}" 2>/dev/null | strip_glab_noise) || true
  if echo "$var_check" | jq -e '.key' >/dev/null 2>&1; then
    payload=$(jq -n \
      --arg val "$token_value" \
      --arg prot "$protected" \
      '{value: $val, masked: "true", protected: $prot}')
    result=$(
      echo "$payload" |
        glab api --method PUT "projects/${PROJECT_PATH_ENCODED}/variables/${var_name}" \
          --input - -H "Content-Type: application/json" 2>/dev/null |
        strip_glab_noise
    )
  else
    payload=$(jq -n \
      --arg key "$var_name" \
      --arg val "$token_value" \
      --arg prot "$protected" \
      '{key: $key, value: $val, masked: "true", protected: $prot}')
    result=$(
      echo "$payload" |
        glab api --method POST "projects/${PROJECT_PATH_ENCODED}/variables" \
          --input - -H "Content-Type: application/json" 2>/dev/null |
        strip_glab_noise
    )
  fi

  if echo "$result" | jq -e '.key' >/dev/null 2>&1; then
    return 0
  fi
  echo "   ❌ Failed to store CI/CD variable: $result"
  return 1
}

# The id of the token the CI/CD variable signs in as, or nothing when it signs
# in as none: missing, empty, revoked, expired or not a token at all.
ci_variable_token_id() {
  local var_name="$1"
  local var_json hidden cred host

  var_json=$(glab api "projects/${PROJECT_PATH_ENCODED}/variables/${var_name}" 2>/dev/null | strip_glab_noise) || return 0
  echo "$var_json" | jq -e '.key' >/dev/null 2>&1 || return 0

  # Hidden variables: GitLab does not expose their value through the API,
  # so we cannot prove sync with the active PAT. Force re-rotation rather
  # than silently trusting a possibly-stale value.
  hidden=$(echo "$var_json" | jq -r '.hidden // false')
  if [ "$hidden" = "true" ]; then
    return 0
  fi

  cred=$(echo "$var_json" | jq -r '.value // empty')
  [ -n "$cred" ] || return 0

  host="${GITLAB_HOST:-}"
  if [ -z "$host" ]; then
    host=$(glab config get host 2>/dev/null) || true
  fi
  : "${host:=gitlab.com}"

  # Use the host's configured API protocol, exactly as the variable lookup did.
  # A failed HTTPS request must never send the credential again over HTTP.
  # GitLab answers which token it is, never its value.
  GITLAB_TOKEN="$cred" glab api --hostname "$host" personal_access_tokens/self 2>/dev/null |
    strip_glab_noise | jq -r '.id // empty' 2>/dev/null || true
}

# The CI/CD variable must hold THE project access token $2 (its id), not just
# any token that signs in: another user's token, another project's, a revoked
# or an expired one all fail here.
verify_ci_variable_token() {
  local self_id
  self_id=$(ci_variable_token_id "$1")
  [ -n "$self_id" ] && [ "$self_id" = "$2" ]
}

# A variable holding the right token can still have lost its masking or its
# protection: put both back, value untouched, so the token is not rotated.
repair_ci_variable_settings() {
  local var_name="$1"
  local protected="$2"
  local var_json result

  var_json=$(glab api "projects/${PROJECT_PATH_ENCODED}/variables/${var_name}" 2>/dev/null | strip_glab_noise) || return 1
  if echo "$var_json" | jq -e --arg prot "$protected" '.masked == true and (.protected | tostring) == $prot' >/dev/null; then
    return 0
  fi

  # The value goes from GitLab's answer straight back into the update: it is
  # never on a command line nor printed.
  result=$(
    echo "$var_json" |
      jq --arg prot "$protected" '{value, masked: "true", protected: $prot}' |
      glab api --method PUT "projects/${PROJECT_PATH_ENCODED}/variables/${var_name}" \
        --input - -H "Content-Type: application/json" 2>/dev/null |
      strip_glab_noise
  ) || true
  if ! echo "$result" | jq -e '.key' >/dev/null 2>&1; then
    echo "   ❌ Failed to repair the settings of CI/CD variable '${var_name}'"
    return 1
  fi
  echo "   🔒 CI/CD variable '${var_name}' settings repaired (masked=true, protected=${protected})"
}

# Put a new token in place of token $1 (none when empty): create it, store it in
# the CI/CD variable, check that the variable signs in as it, and only then
# revoke the old one. Whichever step fails, the old token is still active; when
# GitLab refuses to create or to store the new one, the CI/CD variable is left
# as it was too. A run stopped halfway leaves at most one extra token, and the
# next run revokes whichever one the CI/CD variable does not hold.
replace_token() {
  local old_id="$1"
  local unchanged="nothing was changed"
  local payload response new_id

  [ -z "$old_id" ] || unchanged="token #${old_id} and the CI/CD variable '${TOKEN_NAME}' are unchanged"

  payload=$(jq -n \
    --arg name "$TOKEN_NAME" \
    --argjson al "$REQUIRED_ACCESS_LEVEL" \
    --arg exp "$EXPIRES_AT" \
    --argjson scopes "$SCOPE_JSON" \
    '{name: $name, scopes: $scopes, access_level: $al, expires_at: $exp}')
  response=$(
    echo "$payload" |
      glab api --method POST "projects/${PROJECT_PATH_ENCODED}/access_tokens" --input - \
        -H "Content-Type: application/json" |
      strip_glab_noise
  ) || true
  new_id=$(echo "$response" | jq -r 'select(.token) | .id // empty' 2>/dev/null) || true
  if [ -z "$new_id" ]; then
    echo "   ❌ GitLab refused to create the new token: ${unchanged}."
    exit 1
  fi

  if ! echo "$response" | store_ci_variable "$TOKEN_NAME" "$TOKEN_PROTECTED"; then
    if glab api --method DELETE "projects/${PROJECT_PATH_ENCODED}/access_tokens/${new_id}" >/dev/null 2>&1; then
      echo "   🗑️  Revoked the new token #${new_id}, which nothing holds: ${unchanged}."
    else
      echo "   ⚠️  Could not revoke the new token #${new_id} either, the next run will: ${unchanged}."
    fi
    exit 1
  fi

  if ! verify_ci_variable_token "$TOKEN_NAME" "$new_id"; then
    echo "   ❌ CI/CD variable '${TOKEN_NAME}' was stored but does not sign in as the new token #${new_id}${old_id:+, so token #${old_id} is left active}. Run this command again to finish."
    exit 1
  fi
  echo "   ✅ CI/CD variable '${TOKEN_NAME}' signs in as the new token #${new_id}"

  [ -n "$old_id" ] || return 0
  if glab api --method DELETE "projects/${PROJECT_PATH_ENCODED}/access_tokens/${old_id}" >/dev/null 2>&1; then
    echo "   🗑️  Revoked the old token #${old_id}"
  else
    echo "   ⚠️  Could not revoke the old token #${old_id}, the next run will: the CI/CD variable no longer holds it"
  fi
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

echo "🔐 ${TOKEN_LABEL} Token Setup"
check_permissions

SCOPE_JSON=$(scopes_to_json "$TOKEN_SCOPES")
REQUIRED_ACCESS_LEVEL="$TOKEN_ACCESS_LEVEL"

EXISTING_TOKENS=$(glab api "projects/${PROJECT_PATH_ENCODED}/access_tokens?per_page=100" 2>/dev/null || echo "[]")
MATCHING=$(echo "$EXISTING_TOKENS" | jq -r "[.[] | select(.name == \"${TOKEN_NAME}\" and .revoked == false and .active == true)]")
COUNT=$(echo "$MATCHING" | jq 'length')

if [ "$COUNT" -gt 1 ]; then
  echo "   ⚠️  Found $COUNT active tokens named '${TOKEN_NAME}'. Purging duplicates..."
  # Keep the one the CI/CD variable signs in as, the newest otherwise: a
  # refresh stopped halfway leaves a newer token that nothing holds yet.
  HELD_ID=$(ci_variable_token_id "$TOKEN_NAME")
  KEEP_ID=$(echo "$MATCHING" | jq -r --arg held "$HELD_ID" \
    '[(.[] | select((.id | tostring) == $held)), (sort_by(.created_at) | last)] | first | .id')
  echo "$MATCHING" | jq -r ".[] | select(.id != ${KEEP_ID}) | .id" | while read -r old_id; do
    glab api --method DELETE "projects/${PROJECT_PATH_ENCODED}/access_tokens/${old_id}" >/dev/null 2>&1 || true
    echo "      🗑️  Revoked duplicate token #${old_id}"
  done
  MATCHING=$(echo "$MATCHING" | jq "[.[] | select(.id == ${KEEP_ID})]")
  COUNT=1
fi

REPLACE_ID=""
if [ "$TOKEN_FORCE" = "true" ] && [ "$COUNT" -ge 1 ]; then
  REPLACE_ID=$(echo "$MATCHING" | jq -r '.[0].id')
  echo "   🔄 Force refresh: revoking existing token #${REPLACE_ID} once its replacement is stored..."
  COUNT=0
fi

if [ "$COUNT" -eq 1 ]; then
  EXISTING_ID=$(echo "$MATCHING" | jq -r '.[0].id')
  EXISTING_ACCESS=$(echo "$MATCHING" | jq -r '.[0].access_level')
  MISSING_SCOPES=$(echo "$MATCHING" | jq -r --argjson want "$SCOPE_JSON" '$want - .[0].scopes | join(",")')

  if [ "$EXISTING_ACCESS" -lt "$REQUIRED_ACCESS_LEVEL" ] || [ -n "$MISSING_SCOPES" ]; then
    [ "$EXISTING_ACCESS" -ge "$REQUIRED_ACCESS_LEVEL" ] ||
      echo "   ⚠️  Token has access_level=${EXISTING_ACCESS}, required access_level=${REQUIRED_ACCESS_LEVEL}"
    [ -z "$MISSING_SCOPES" ] ||
      echo "   ⚠️  Token is missing the scopes: ${MISSING_SCOPES}"
    echo "      Recreating it with the required access level and scopes, revoked once its replacement is stored..."
    REPLACE_ID="$EXISTING_ID"
    COUNT=0
  else
    if verify_ci_variable_token "$TOKEN_NAME" "$EXISTING_ID"; then
      repair_ci_variable_settings "$TOKEN_NAME" "$TOKEN_PROTECTED" || exit 1
      echo "   ✅ Token '${TOKEN_NAME}' exists and is valid (access_level=${EXISTING_ACCESS})"
      echo "✅ Done! ${TOKEN_LABEL} is ready to use."
      exit 0
    fi

    echo "   🔄 Token exists but CI/CD variable is missing or out of sync. Rotating..."
    replace_token "$EXISTING_ID"
    echo "   ✅ Token rotated and CI/CD variable '${TOKEN_NAME}' stored"
    echo "✅ Done! ${TOKEN_LABEL} is ready to use."
    exit 0
  fi
fi

if [ "$COUNT" -eq 0 ]; then
  echo "   🔑 Creating new Project Access Token '${TOKEN_NAME}' (access_level=${REQUIRED_ACCESS_LEVEL}, expires ${EXPIRES_AT})..."
  replace_token "$REPLACE_ID"
  echo "   ✅ Token created and CI/CD variable '${TOKEN_NAME}' stored"
fi

echo "✅ Done! ${TOKEN_LABEL} is ready to use."
