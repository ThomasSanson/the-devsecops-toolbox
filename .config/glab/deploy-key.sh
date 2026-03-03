#!/usr/bin/env bash
set -euo pipefail

# Disable xtrace to prevent leaking keys in CI logs
set +x

# -------------------------------------------------------------------
# Commitizen Deploy Key Manager
#
# Creates an SSH deploy key for Commitizen and stores the private key
# as a CI/CD variable. The key pair is generated in a temporary
# directory that is always cleaned up (via trap), even on failure.
# -------------------------------------------------------------------

# --- Configuration (from environment) ---
DEPLOY_KEY_TITLE="${TASK_GLAB_DEPLOY_KEY_TITLE:-Commitizen Deploy Key}"
CI_VAR_NAME="${TASK_GLAB_DEPLOY_KEY_VAR_NAME:-CZ_DEPLOY_KEY}"
CI_VAR_PROTECTED="${TASK_GLAB_DEPLOY_KEY_PROTECTED:-true}"

# --- Secure temp directory with cleanup trap ---
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# --- Helper: extract JSON from glab output ---
# glab may append version upgrade notices on the same line as JSON output.
# This strips everything after the last closing brace to get clean JSON.
strip_glab_noise() {
  sed 's/}[^}]*$/}/'
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
echo "🔑 Deploy Key Setup"

check_permissions

# Fetch existing deploy keys matching the configured title
EXISTING_KEYS=$(glab api "projects/:id/deploy_keys?per_page=100" 2>/dev/null || echo "[]")
MATCHING=$(echo "$EXISTING_KEYS" | jq -r "[.[] | select(.title == \"${DEPLOY_KEY_TITLE}\")]")
COUNT=$(echo "$MATCHING" | jq 'length')

# --- Idempotency: deploy key + CI/CD variable both exist → nothing to do ---
if [ "$COUNT" -ge 1 ]; then
  var_check=$(glab api "projects/:id/variables/${CI_VAR_NAME}" 2>/dev/null | strip_glab_noise) || true
  if echo "$var_check" | jq -e '.key' >/dev/null 2>&1; then
    echo "   ✅ Deploy key '${DEPLOY_KEY_TITLE}' and CI/CD variable '${CI_VAR_NAME}' already exist"
    echo "✅ Done! Deploy key is ready."
    exit 0
  fi
fi

# --- Remove existing deploy keys with same title (start fresh) ---
if [ "$COUNT" -ge 1 ]; then
  echo "   🔄 Removing existing deploy key(s) '${DEPLOY_KEY_TITLE}'..."
  echo "$MATCHING" | jq -r '.[].id' | while read -r key_id; do
    glab api --method DELETE "projects/:id/deploy_keys/${key_id}" >/dev/null 2>&1 || true
    echo "      🗑️  Removed deploy key #${key_id}"
  done
fi

# --- Generate SSH key pair ---
echo "   🔐 Generating SSH key pair (ed25519)..."
ssh-keygen -t ed25519 -C "${DEPLOY_KEY_TITLE}" -f "${TMPDIR}/cz_deploy_key" -N "" -q

PUBLIC_KEY=$(cat "${TMPDIR}/cz_deploy_key.pub")
PRIVATE_KEY=$(cat "${TMPDIR}/cz_deploy_key")

# --- Create deploy key via API ---
echo "   🔑 Creating deploy key '${DEPLOY_KEY_TITLE}' with write access..."
PAYLOAD=$(jq -n \
  --arg title "$DEPLOY_KEY_TITLE" \
  --arg key "$PUBLIC_KEY" \
  '{title: $title, key: $key, can_push: true}')
RESPONSE=$(echo "$PAYLOAD" |
  glab api --method POST "projects/:id/deploy_keys" \
    --input - -H "Content-Type: application/json" 2>/dev/null | strip_glab_noise)

if ! echo "$RESPONSE" | jq -e '.id' >/dev/null 2>&1; then
  echo "   ❌ Failed to create deploy key: $RESPONSE"
  exit 1
fi
echo "   ✅ Deploy key created with write access"

# --- Store private key as CI/CD variable (type=file, protected, not masked) ---
echo "   📝 Storing private key as CI/CD variable '${CI_VAR_NAME}'..."
var_check=$(glab api "projects/:id/variables/${CI_VAR_NAME}" 2>/dev/null | strip_glab_noise) || true
if echo "$var_check" | jq -e '.key' >/dev/null 2>&1; then
  # Variable exists — update it
  PAYLOAD=$(jq -n \
    --arg val "$PRIVATE_KEY" \
    --arg prot "$CI_VAR_PROTECTED" \
    '{value: $val, variable_type: "file", protected: $prot, masked: "false"}')
  RESULT=$(echo "$PAYLOAD" |
    glab api --method PUT "projects/:id/variables/${CI_VAR_NAME}" \
      --input - -H "Content-Type: application/json" 2>/dev/null | strip_glab_noise)
else
  # Variable doesn't exist — create it
  PAYLOAD=$(jq -n \
    --arg key "$CI_VAR_NAME" \
    --arg val "$PRIVATE_KEY" \
    --arg prot "$CI_VAR_PROTECTED" \
    '{key: $key, value: $val, variable_type: "file", protected: $prot, masked: "false"}')
  RESULT=$(echo "$PAYLOAD" |
    glab api --method POST "projects/:id/variables" \
      --input - -H "Content-Type: application/json" 2>/dev/null | strip_glab_noise)
fi

# Explicit cleanup (trap handles edge cases, this is belt-and-suspenders)
rm -rf "$TMPDIR"

if echo "$RESULT" | jq -e '.key' >/dev/null 2>&1; then
  echo "   ✅ CI/CD variable '${CI_VAR_NAME}' stored (type=file, protected=${CI_VAR_PROTECTED})"
else
  echo "   ❌ Failed to store CI/CD variable: $RESULT"
  exit 1
fi

echo "✅ Done! Deploy key is ready."
