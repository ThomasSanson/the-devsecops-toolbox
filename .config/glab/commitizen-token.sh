#!/usr/bin/env bash
set -euo pipefail

# Disable xtrace to prevent leaking the token in CI logs
set +x

# -------------------------------------------------------------------
# Commitizen Project Access Token Manager
#
# Creates or refreshes a GitLab Project Access Token for Commitizen.
# The token is NEVER stored in a shell variable longer than needed
# and is piped directly to CI/CD variable storage.
# -------------------------------------------------------------------

# --- Configuration (from environment) ---
COMMITIZEN_TOKEN_NAME="${TASK_GLAB_COMMITIZEN_TOKEN_NAME:-TASK_COMMITIZEN_TOKEN}"
COMMITIZEN_TOKEN_PROTECTED="${TASK_GLAB_COMMITIZEN_TOKEN_PROTECTED:-true}"
COMMITIZEN_TOKEN_FORCE="${TASK_GLAB_COMMITIZEN_TOKEN_FORCE:-false}"
REQUIRED_ACCESS_LEVEL=40

# Compute expiration date (+1 year, cross-platform)
if EXPIRES_AT=$(date -v +1y +%Y-%m-%d 2>/dev/null); then
  :
else
  EXPIRES_AT=$(date -d '+1 year' +%Y-%m-%d)
fi

strip_glab_noise() {
  sed 's/}[^}]*$/}/'
}

# Reads API response from stdin and stores token as a masked CI variable.
store_ci_variable() {
  local var_name="$1" protected="$2"
  local api_response token_value payload result var_check

  api_response=$(cat)
  token_value=$(echo "$api_response" | strip_glab_noise | jq -r '.token // empty')
  if [ -z "$token_value" ]; then
    echo "   ❌ No token value found in API response"
    return 1
  fi

  var_check=$(glab api "projects/:id/variables/${var_name}" 2>/dev/null | strip_glab_noise) || true
  if echo "$var_check" | jq -e '.key' >/dev/null 2>&1; then
    payload=$(jq -n \
      --arg val "$token_value" \
      --arg prot "$protected" \
      '{value: $val, masked: "true", protected: $prot}')
    result=$(echo "$payload" |
      glab api --method PUT "projects/:id/variables/${var_name}" \
        --input - -H "Content-Type: application/json" 2>/dev/null | strip_glab_noise)
  else
    payload=$(jq -n \
      --arg key "$var_name" \
      --arg val "$token_value" \
      --arg prot "$protected" \
      '{key: $key, value: $val, masked: "true", protected: $prot}')
    result=$(echo "$payload" |
      glab api --method POST "projects/:id/variables" \
        --input - -H "Content-Type: application/json" 2>/dev/null | strip_glab_noise)
  fi

  if echo "$result" | jq -e '.key' >/dev/null 2>&1; then
    return 0
  fi
  echo "   ❌ Failed to store CI/CD variable: $result"
  return 1
}

verify_ci_variable_token() {
  local var_name="$1"
  local var_json hidden cred host protocol url

  var_json=$(glab api "projects/:id/variables/${var_name}" 2>/dev/null | strip_glab_noise) || return 1
  echo "$var_json" | jq -e '.key' >/dev/null 2>&1 || return 1

  hidden=$(echo "$var_json" | jq -r '.hidden // false')
  if [ "$hidden" = "true" ]; then
    return 0
  fi

  cred=$(echo "$var_json" | jq -r '.value // empty')
  [ -n "$cred" ] || return 1

  host="${GITLAB_HOST:-}"
  if [ -z "$host" ]; then
    host=$(glab config get host 2>/dev/null) || true
  fi
  : "${host:=gitlab.com}"

  protocol=$(glab config get -h "$host" api_protocol 2>/dev/null) || true
  : "${protocol:=https}"
  url="${protocol}://${host}/api/v4/user"

  if command -v curl >/dev/null 2>&1; then
    curl -sf -o /dev/null "$url" -H "Authorization: Bearer ${cred}"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O /dev/null --header="Authorization: Bearer ${cred}" "$url"
  else
    return 0
  fi
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

echo "🔐 Commitizen Token Setup"
check_permissions

EXISTING_TOKENS=$(glab api "projects/:id/access_tokens?per_page=100" 2>/dev/null || echo "[]")
MATCHING=$(echo "$EXISTING_TOKENS" | jq -r "[.[] | select(.name == \"${COMMITIZEN_TOKEN_NAME}\" and .revoked == false and .active == true)]")
COUNT=$(echo "$MATCHING" | jq 'length')

if [ "$COUNT" -gt 1 ]; then
  echo "   ⚠️  Found $COUNT active tokens named '${COMMITIZEN_TOKEN_NAME}'. Purging duplicates..."
  NEWEST_ID=$(echo "$MATCHING" | jq -r 'sort_by(.created_at) | last | .id')
  echo "$MATCHING" | jq -r ".[] | select(.id != ${NEWEST_ID}) | .id" | while read -r old_id; do
    glab api --method DELETE "projects/:id/access_tokens/${old_id}" >/dev/null 2>&1 || true
    echo "      🗑️  Revoked duplicate token #${old_id}"
  done
  MATCHING=$(echo "$MATCHING" | jq "[.[] | select(.id == ${NEWEST_ID})]")
  COUNT=1
fi

if [ "$COMMITIZEN_TOKEN_FORCE" = "true" ] && [ "$COUNT" -ge 1 ]; then
  EXISTING_ID=$(echo "$MATCHING" | jq -r '.[0].id')
  echo "   🔄 Force refresh: revoking existing token #${EXISTING_ID}..."
  glab api --method DELETE "projects/:id/access_tokens/${EXISTING_ID}" >/dev/null 2>&1 || true
  COUNT=0
fi

if [ "$COUNT" -eq 1 ]; then
  EXISTING_ID=$(echo "$MATCHING" | jq -r '.[0].id')
  EXISTING_ACCESS=$(echo "$MATCHING" | jq -r '.[0].access_level')

  if [ "$EXISTING_ACCESS" -lt "$REQUIRED_ACCESS_LEVEL" ]; then
    echo "   ⚠️  Token has access_level=${EXISTING_ACCESS}, required access_level=${REQUIRED_ACCESS_LEVEL}"
    echo "      Revoking and recreating with correct access level..."
    glab api --method DELETE "projects/:id/access_tokens/${EXISTING_ID}" >/dev/null 2>&1
    COUNT=0
  else
    if glab api "projects/:id/variables/${COMMITIZEN_TOKEN_NAME}" >/dev/null 2>&1 &&
      verify_ci_variable_token "$COMMITIZEN_TOKEN_NAME"; then
      echo "   ✅ Token '${COMMITIZEN_TOKEN_NAME}' exists and is valid (access_level=${EXISTING_ACCESS})"
      echo "✅ Done! Commitizen is ready to use."
      exit 0
    else
      echo "   🔄 Token exists but CI/CD variable is missing or out of sync. Rotating..."
      glab api --method POST "projects/:id/access_tokens/${EXISTING_ID}/rotate" \
        -f "expires_at=${EXPIRES_AT}" | strip_glab_noise |
        store_ci_variable "$COMMITIZEN_TOKEN_NAME" "$COMMITIZEN_TOKEN_PROTECTED"
      echo "   ✅ Token rotated and CI/CD variable '${COMMITIZEN_TOKEN_NAME}' stored"
      echo "✅ Done! Commitizen is ready to use."
      exit 0
    fi
  fi
fi

if [ "$COUNT" -eq 0 ]; then
  echo "   🔑 Creating new Project Access Token '${COMMITIZEN_TOKEN_NAME}' (access_level=${REQUIRED_ACCESS_LEVEL}, expires ${EXPIRES_AT})..."
  PAYLOAD=$(jq -n \
    --arg name "$COMMITIZEN_TOKEN_NAME" \
    --argjson al "$REQUIRED_ACCESS_LEVEL" \
    --arg exp "$EXPIRES_AT" \
    '{name: $name, scopes: ["api", "write_repository"], access_level: $al, expires_at: $exp}')
  TOKEN_RESPONSE=$(echo "$PAYLOAD" |
    glab api --method POST projects/:id/access_tokens --input - \
      -H "Content-Type: application/json" | strip_glab_noise)
  echo "$TOKEN_RESPONSE" |
    store_ci_variable "$COMMITIZEN_TOKEN_NAME" "$COMMITIZEN_TOKEN_PROTECTED"
  echo "   ✅ Token created and CI/CD variable '${COMMITIZEN_TOKEN_NAME}' stored"
fi

echo "✅ Done! Commitizen is ready to use."
