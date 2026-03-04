#!/usr/bin/env bash
set -euo pipefail

# -------------------------------------------------------------------
# Protected Branch Configuration
#
# Configures the default branch with strict protection rules:
#   - merge_access_level=40 (Maintainers)
#   - push_access_level=0 (No one)
#   - deploy key added to push access (if API supports it)
#
# On GitLab CE/Free, the API does not support adding deploy keys
# to protected branch push access. In that case, the script falls
# back to an interactive loop guiding the user through the UI.
# -------------------------------------------------------------------

# --- Configuration (from environment) ---
DEPLOY_KEY_TITLE="${TASK_GLAB_DEPLOY_KEY_TITLE:-Commitizen Deploy Key}"
BRANCH="${TASK_GLAB_PROTECTED_BRANCH:-main}"

# --- Helper: extract JSON from glab output ---
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

# --- Verify protected branch state ---
# Returns 0 if branch is correctly configured, 1 otherwise.
# Prints specific error messages for each failed check.
verify_protected_branch_state() {
  local branch_data merge_ok push_ok deploy_key_ok errors

  branch_data=$(glab api "projects/:id/protected_branches/${BRANCH}" 2>/dev/null | strip_glab_noise) || {
    echo "   ❌ Branch '${BRANCH}' is not protected"
    return 1
  }

  errors=0

  # Check merge_access_levels contains access_level=40 (Maintainers)
  merge_ok=$(echo "$branch_data" | jq '[.merge_access_levels[] | select(.access_level == 40)] | length')
  if [ "$merge_ok" -lt 1 ]; then
    echo "   ❌ Allowed to merge: expected Maintainers (access_level=40), got: $(echo "$branch_data" | jq -c '.merge_access_levels')"
    errors=1
  else
    echo "   ✅ Allowed to merge: Maintainers"
  fi

  # Check push_access_levels contains access_level=0 (No one)
  push_ok=$(echo "$branch_data" | jq '[.push_access_levels[] | select(.access_level == 0)] | length')
  if [ "$push_ok" -lt 1 ]; then
    echo "   ❌ Allowed to push: expected No one (access_level=0), got: $(echo "$branch_data" | jq -c '.push_access_levels')"
    errors=1
  else
    echo "   ✅ Allowed to push: No one"
  fi

  # Check deploy key presence in push_access_levels (best-effort, may not be exposed on CE)
  if [ -n "${DEPLOY_KEY_ID:-}" ]; then
    deploy_key_ok=$(echo "$branch_data" | jq "[.push_access_levels[] | select(.deploy_key_id == ${DEPLOY_KEY_ID})] | length")
    if [ "$deploy_key_ok" -lt 1 ]; then
      echo "   ⚠️  Deploy key '${DEPLOY_KEY_TITLE}' (id=${DEPLOY_KEY_ID}) not found in push access"
      echo "      (This may be normal on CE/Free — verification via API is limited)"
      # Don't increment errors — best-effort check
    else
      echo "   ✅ Deploy key '${DEPLOY_KEY_TITLE}' in push access"
    fi
  fi

  return $errors
}

# --- Main logic ---
echo "🔒 Protected Branch Configuration"

check_permissions

# 1. Get deploy key ID
EXISTING_KEYS=$(glab api "projects/:id/deploy_keys?per_page=100" 2>/dev/null || echo "[]")
DEPLOY_KEY_ID=$(echo "$EXISTING_KEYS" | jq -r "[.[] | select(.title == \"${DEPLOY_KEY_TITLE}\")] | .[0].id // empty")
if [ -z "$DEPLOY_KEY_ID" ]; then
  echo "   ⚠️  Deploy key '${DEPLOY_KEY_TITLE}' not found — skipping deploy key push access"
fi

# 2. DELETE existing protection (purge stale access levels)
echo "   🔄 Resetting protection on branch '${BRANCH}'..."
glab api --method DELETE "projects/:id/protected_branches/${BRANCH}" >/dev/null 2>&1 || true

# 3. POST new protection with strict rules
echo "   🔒 Protecting branch '${BRANCH}' (merge=Maintainers, push=No one)..."

# Try with deploy key in allowed_to_push (works on Premium/Ultimate)
DEPLOY_KEY_ADDED=false
if [ -n "$DEPLOY_KEY_ID" ]; then
  echo "   🔑 Attempting to add deploy key to push access via API..."
  RESPONSE=$(glab api --method POST \
    "projects/:id/protected_branches?name=${BRANCH}&merge_access_level=40&push_access_level=0&allowed_to_push[][deploy_key_id]=${DEPLOY_KEY_ID}" \
    2>/dev/null | strip_glab_noise) || RESPONSE=""

  if echo "$RESPONSE" | jq -e '.name' >/dev/null 2>&1; then
    DEPLOY_KEY_ADDED=true
    echo "   ✅ Branch '${BRANCH}' protected with deploy key in push access"
  else
    echo "   ⚠️  API does not support deploy_key_id (CE/Free edition detected)"
    echo "   🔒 Protecting branch with basic rules..."
    # Fallback: protect without deploy key
    RESPONSE=$(glab api --method POST \
      "projects/:id/protected_branches?name=${BRANCH}&merge_access_level=40&push_access_level=0" \
      2>/dev/null | strip_glab_noise)
    if ! echo "$RESPONSE" | jq -e '.name' >/dev/null 2>&1; then
      echo "   ❌ Failed to protect branch: $RESPONSE"
      exit 1
    fi
    echo "   ✅ Branch '${BRANCH}' protected (merge=Maintainers, push=No one)"
  fi
else
  # No deploy key — just protect with basic rules
  RESPONSE=$(glab api --method POST \
    "projects/:id/protected_branches?name=${BRANCH}&merge_access_level=40&push_access_level=0" \
    2>/dev/null | strip_glab_noise)
  if ! echo "$RESPONSE" | jq -e '.name' >/dev/null 2>&1; then
    echo "   ❌ Failed to protect branch: $RESPONSE"
    exit 1
  fi
  echo "   ✅ Branch '${BRANCH}' protected (merge=Maintainers, push=No one)"
fi

# 4. If deploy key was not added via API, fall back to interactive mode
if [ "$DEPLOY_KEY_ADDED" = "false" ] && [ -n "$DEPLOY_KEY_ID" ]; then
  # Check if we are in an interactive terminal (not CI)
  IS_CI="${CI:-}"
  IS_INTERACTIVE=false
  if [ -z "$IS_CI" ] && [ -t 0 ]; then
    IS_INTERACTIVE=true
  fi

  if [ "$IS_INTERACTIVE" = "true" ]; then
    # Get project web URL for the direct link
    PROJECT_WEB_URL=$(glab api projects/:id 2>/dev/null | jq -r '.web_url')

    echo ""
    echo "   ⚠️  API edition limitée détectée, passage en mode guidage manuel."
    echo ""

    while true; do
      echo "   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "   📋 Action requise: configurer la règle '${BRANCH}' dans GitLab UI."
      echo ""
      echo "   1. Ouvrir: ${PROJECT_WEB_URL}/-/settings/repository"
      echo "   2. Aller à: Protected branches"
      echo "   3. Éditer la règle: ${BRANCH}"
      echo "   4. Mettre Allowed to merge = Maintainers"
      echo "   5. Mettre Allowed to push and merge = No one"
      echo "   6. Ajouter l'exception: deploy key '${DEPLOY_KEY_TITLE}'"
      echo "   7. Cliquer Save changes"
      echo "   8. Revenir ici et taper 'ok'"
      echo "   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo ""

      read -r -p "   Tapez 'ok' quand c'est fait: " ans
      if [ "$ans" != "ok" ]; then
        continue
      fi

      echo ""
      echo "   🔍 Vérification en cours..."
      if verify_protected_branch_state; then
        echo "   ✅ Configuration validée."
        break
      else
        echo ""
        echo "   ❌ Configuration incomplète. Veuillez réessayer."
        echo ""
      fi
    done
  else
    # CI or non-interactive: warn but don't block
    echo ""
    echo "   ⚠️  La deploy key '${DEPLOY_KEY_TITLE}' n'a pas pu être ajoutée automatiquement"
    echo "      à la règle de protection de la branche '${BRANCH}'."
    echo "      Un Maintainer doit configurer manuellement via l'UI GitLab :"
    echo "      Settings > Repository > Protected branches > ${BRANCH}"
    echo "      → Ajouter '${DEPLOY_KEY_TITLE}' dans 'Allowed to push and merge'"
    echo ""
  fi
fi

echo "✅ Done! Protected branch '${BRANCH}' is configured."
