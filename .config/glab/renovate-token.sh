#!/usr/bin/env bash
set -euo pipefail

# -------------------------------------------------------------------
# Renovate Project Access Token Manager
#
# Creates or refreshes a GitLab Project Access Token for Renovate.
# The token is NEVER stored in a shell variable — it flows through
# pipes directly from creation/rotation to CI/CD variable storage.
# -------------------------------------------------------------------

# --- Configuration (from environment) ---
RENOVATE_TOKEN_NAME="${TASK_GLAB_RENOVATE_TOKEN_NAME:-TASK_RENOVATE_TOKEN}"
RENOVATE_TOKEN_PROTECTED="${TASK_GLAB_RENOVATE_TOKEN_PROTECTED:-true}"
RENOVATE_TOKEN_FORCE="${TASK_GLAB_RENOVATE_TOKEN_FORCE:-false}"
REQUIRED_ACCESS_LEVEL=40

# Compute expiration date (+1 year, cross-platform)
if EXPIRES_AT=$(date -v +1y +%Y-%m-%d 2>/dev/null); then
  : # BSD date succeeded
else
  EXPIRES_AT=$(date -d '+1 year' +%Y-%m-%d)
fi

# --- Helper: extract JSON from glab output ---
# glab may append version upgrade notices on the same line as JSON output.
# This strips everything after the last closing brace to get clean JSON.
strip_glab_noise() {
  sed 's/}[^}]*$/}/'
}

# --- Helper: store token as CI/CD variable via pure piping ---
# Reads the raw API JSON response from stdin, extracts .token via jq,
# and stores it as a CI/CD variable. The token value never touches
# a shell variable or command-line argument.
store_ci_variable() {
  local var_name="$1" protected="$2"

  # Save stdin (API response with token) before it gets consumed
  local api_response
  api_response=$(cat)

  # Extract token value from API response
  local token_value
  token_value=$(echo "$api_response" | strip_glab_noise | jq -r '.token // empty')
  if [ -z "$token_value" ]; then
    echo "   ❌ No token value found in API response"
    return 1
  fi

  # Check if variable already exists to decide POST vs PUT
  local payload result var_check
  var_check=$(glab api "projects/:id/variables/${var_name}" 2>/dev/null | strip_glab_noise) || true
  if echo "$var_check" | jq -e '.key' >/dev/null 2>&1; then
    # Variable exists — update it
    payload=$(jq -n \
      --arg val "$token_value" \
      --arg prot "$protected" \
      '{value: $val, masked: "true", protected: $prot}')
    result=$(echo "$payload" | glab api --method PUT "projects/:id/variables/${var_name}" \
      --input - -H "Content-Type: application/json" 2>/dev/null | strip_glab_noise)
  else
    # Variable doesn't exist — create it
    payload=$(jq -n \
      --arg key "$var_name" \
      --arg val "$token_value" \
      --arg prot "$protected" \
      '{key: $key, value: $val, masked: "true", protected: $prot}')
    result=$(echo "$payload" | glab api --method POST "projects/:id/variables" \
      --input - -H "Content-Type: application/json" 2>/dev/null | strip_glab_noise)
  fi

  # Verify the result contains a key (success) or report error
  if echo "$result" | jq -e '.key' >/dev/null 2>&1; then
    return 0
  else
    echo "   ❌ Failed to store CI/CD variable: $result"
    return 1
  fi
}

# --- Check permissions (Maintainer required: access_level >= 40) ---
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

# --- Main logic ---
echo "🔐 Renovate Token Setup"

check_permissions

# Fetch existing tokens matching the configured name
EXISTING_TOKENS=$(glab api "projects/:id/access_tokens?per_page=100" 2>/dev/null || echo "[]")
MATCHING=$(echo "$EXISTING_TOKENS" | jq -r "[.[] | select(.name == \"${RENOVATE_TOKEN_NAME}\" and .revoked == false and .active == true)]")
COUNT=$(echo "$MATCHING" | jq 'length')

# --- Purge duplicates (keep newest) ---
if [ "$COUNT" -gt 1 ]; then
  echo "   ⚠️  Found $COUNT active tokens named '${RENOVATE_TOKEN_NAME}'. Purging duplicates..."
  NEWEST_ID=$(echo "$MATCHING" | jq -r 'sort_by(.created_at) | last | .id')
  echo "$MATCHING" | jq -r ".[] | select(.id != ${NEWEST_ID}) | .id" | while read -r old_id; do
    glab api --method DELETE "projects/:id/access_tokens/${old_id}" >/dev/null 2>&1 || true
    echo "      🗑️  Revoked duplicate token #${old_id}"
  done
  MATCHING=$(echo "$MATCHING" | jq "[.[] | select(.id == ${NEWEST_ID})]")
  COUNT=1
fi

# --- Force mode: revoke existing and create fresh ---
if [ "$RENOVATE_TOKEN_FORCE" = "true" ] && [ "$COUNT" -ge 1 ]; then
  EXISTING_ID=$(echo "$MATCHING" | jq -r '.[0].id')
  echo "   🔄 Force refresh: revoking existing token #${EXISTING_ID}..."
  glab api --method DELETE "projects/:id/access_tokens/${EXISTING_ID}" >/dev/null 2>&1 || true
  COUNT=0
fi

# --- Existing token: check access_level and CI variable ---
if [ "$COUNT" -eq 1 ]; then
  EXISTING_ID=$(echo "$MATCHING" | jq -r '.[0].id')
  EXISTING_ACCESS=$(echo "$MATCHING" | jq -r '.[0].access_level')

  # Check access_level meets requirement
  if [ "$EXISTING_ACCESS" -lt "$REQUIRED_ACCESS_LEVEL" ]; then
    echo "   ⚠️  Token has access_level=${EXISTING_ACCESS}, required access_level=${REQUIRED_ACCESS_LEVEL}"
    echo "      Revoking and recreating with correct access level..."
    glab api --method DELETE "projects/:id/access_tokens/${EXISTING_ID}" >/dev/null 2>&1
    COUNT=0
  else
    # Check CI/CD variable exists
    if glab api "projects/:id/variables/${RENOVATE_TOKEN_NAME}" >/dev/null 2>&1; then
      echo "   ✅ Token '${RENOVATE_TOKEN_NAME}' exists and is valid (access_level=${EXISTING_ACCESS})"
      echo "✅ Done! Renovate is ready to use."
      exit 0
    else
      echo "   🔄 Token exists but CI/CD variable is missing. Rotating..."
      glab api --method POST "projects/:id/access_tokens/${EXISTING_ID}/rotate" \
        -f "expires_at=${EXPIRES_AT}" | strip_glab_noise |
        store_ci_variable "$RENOVATE_TOKEN_NAME" "$RENOVATE_TOKEN_PROTECTED"
      echo "   ✅ Token rotated and CI/CD variable '${RENOVATE_TOKEN_NAME}' stored"
      echo "✅ Done! Renovate is ready to use."
      exit 0
    fi
  fi
fi

# --- Create new token (piped directly to CI/CD storage) ---
if [ "$COUNT" -eq 0 ]; then
  echo "   🔑 Creating new Project Access Token '${RENOVATE_TOKEN_NAME}' (access_level=${REQUIRED_ACCESS_LEVEL}, expires ${EXPIRES_AT})..."
  PAYLOAD=$(jq -n \
    --arg name "$RENOVATE_TOKEN_NAME" \
    --argjson al "$REQUIRED_ACCESS_LEVEL" \
    --arg exp "$EXPIRES_AT" \
    '{name: $name, scopes: ["api"], access_level: $al, expires_at: $exp}')
  TOKEN_RESPONSE=$(echo "$PAYLOAD" |
    glab api --method POST projects/:id/access_tokens --input - \
      -H "Content-Type: application/json" | strip_glab_noise)
  echo "$TOKEN_RESPONSE" |
    store_ci_variable "$RENOVATE_TOKEN_NAME" "$RENOVATE_TOKEN_PROTECTED"
  echo "   ✅ Token created and CI/CD variable '${RENOVATE_TOKEN_NAME}' stored"
fi

echo "✅ Done! Renovate is ready to use."
