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

if [ -z "$TOKEN_NAME" ]; then
  echo "❌ TASK_GLAB_PROJECT_TOKEN_NAME is required." >&2
  exit 1
fi

if ! [[ "$TOKEN_ACCESS_LEVEL" =~ ^[0-9]+$ ]]; then
  echo "❌ TASK_GLAB_PROJECT_TOKEN_ACCESS_LEVEL must be numeric." >&2
  exit 1
fi

if EXPIRES_AT=$(date -v +1y +%Y-%m-%d 2>/dev/null); then
  :
else
  EXPIRES_AT=$(date -d '+1 year' +%Y-%m-%d)
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

  var_check=$(glab api "projects/:id/variables/${var_name}" 2>/dev/null | strip_glab_noise) || true
  if echo "$var_check" | jq -e '.key' >/dev/null 2>&1; then
    payload=$(jq -n \
      --arg val "$token_value" \
      --arg prot "$protected" \
      '{value: $val, masked: "true", protected: $prot}')
    result=$(
      echo "$payload" |
        glab api --method PUT "projects/:id/variables/${var_name}" \
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
        glab api --method POST "projects/:id/variables" \
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

verify_ci_variable_token() {
  local var_name="$1"
  local var_json hidden cred host

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

  # Try HTTPS first (gitlab.com default), fall back to HTTP (self-hosted/local).
  # Avoids fragile protocol detection via glab config which varies across versions.
  if command -v curl >/dev/null 2>&1; then
    curl -sf --connect-timeout 5 -o /dev/null "https://${host}/api/v4/user" -H "PRIVATE-TOKEN: ${cred}" 2>/dev/null ||
      curl -sf --connect-timeout 5 -o /dev/null "http://${host}/api/v4/user" -H "PRIVATE-TOKEN: ${cred}"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -T 5 -O /dev/null --header="PRIVATE-TOKEN: ${cred}" "https://${host}/api/v4/user" 2>/dev/null ||
      wget -q -T 5 -O /dev/null --header="PRIVATE-TOKEN: ${cred}" "http://${host}/api/v4/user"
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

echo "🔐 ${TOKEN_LABEL} Token Setup"
check_permissions

SCOPE_JSON=$(scopes_to_json "$TOKEN_SCOPES")
REQUIRED_ACCESS_LEVEL="$TOKEN_ACCESS_LEVEL"

EXISTING_TOKENS=$(glab api "projects/:id/access_tokens?per_page=100" 2>/dev/null || echo "[]")
MATCHING=$(echo "$EXISTING_TOKENS" | jq -r "[.[] | select(.name == \"${TOKEN_NAME}\" and .revoked == false and .active == true)]")
COUNT=$(echo "$MATCHING" | jq 'length')

if [ "$COUNT" -gt 1 ]; then
  echo "   ⚠️  Found $COUNT active tokens named '${TOKEN_NAME}'. Purging duplicates..."
  NEWEST_ID=$(echo "$MATCHING" | jq -r 'sort_by(.created_at) | last | .id')
  echo "$MATCHING" | jq -r ".[] | select(.id != ${NEWEST_ID}) | .id" | while read -r old_id; do
    glab api --method DELETE "projects/:id/access_tokens/${old_id}" >/dev/null 2>&1 || true
    echo "      🗑️  Revoked duplicate token #${old_id}"
  done
  MATCHING=$(echo "$MATCHING" | jq "[.[] | select(.id == ${NEWEST_ID})]")
  COUNT=1
fi

if [ "$TOKEN_FORCE" = "true" ] && [ "$COUNT" -ge 1 ]; then
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
    if glab api "projects/:id/variables/${TOKEN_NAME}" >/dev/null 2>&1 &&
      verify_ci_variable_token "$TOKEN_NAME"; then
      echo "   ✅ Token '${TOKEN_NAME}' exists and is valid (access_level=${EXISTING_ACCESS})"
      echo "✅ Done! ${TOKEN_LABEL} is ready to use."
      exit 0
    fi

    echo "   🔄 Token exists but CI/CD variable is missing or out of sync. Rotating..."
    glab api --method POST "projects/:id/access_tokens/${EXISTING_ID}/rotate" \
      -f "expires_at=${EXPIRES_AT}" |
      strip_glab_noise |
      store_ci_variable "$TOKEN_NAME" "$TOKEN_PROTECTED"
    echo "   ✅ Token rotated and CI/CD variable '${TOKEN_NAME}' stored"
    echo "✅ Done! ${TOKEN_LABEL} is ready to use."
    exit 0
  fi
fi

if [ "$COUNT" -eq 0 ]; then
  echo "   🔑 Creating new Project Access Token '${TOKEN_NAME}' (access_level=${REQUIRED_ACCESS_LEVEL}, expires ${EXPIRES_AT})..."
  PAYLOAD=$(jq -n \
    --arg name "$TOKEN_NAME" \
    --argjson al "$REQUIRED_ACCESS_LEVEL" \
    --arg exp "$EXPIRES_AT" \
    --argjson scopes "$SCOPE_JSON" \
    '{name: $name, scopes: $scopes, access_level: $al, expires_at: $exp}')
  TOKEN_RESPONSE=$(
    echo "$PAYLOAD" |
      glab api --method POST projects/:id/access_tokens --input - \
        -H "Content-Type: application/json" |
      strip_glab_noise
  )
  echo "$TOKEN_RESPONSE" |
    store_ci_variable "$TOKEN_NAME" "$TOKEN_PROTECTED"
  echo "   ✅ Token created and CI/CD variable '${TOKEN_NAME}' stored"
fi

echo "✅ Done! ${TOKEN_LABEL} is ready to use."
