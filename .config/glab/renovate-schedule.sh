#!/usr/bin/env bash
set -euo pipefail

# -------------------------------------------------------------------
# Renovate Schedule
#
# Gives the project a pipeline schedule, "Renovate", once a night on the
# default branch. With a schedule, pipelines on the default branch leave
# Renovate to it (devsecops:feedback:renovate): a merge no longer rebases
# every open Renovate merge request, each rebase a full pipeline.
# The night time comes from the project's id, between 2:00 and 4:59
# Europe/Paris, so the projects of a group do not all start at once, and
# none at 1:00, when the toolbox runs its own.
# A project that already has an active schedule keeps it as it is.
# -------------------------------------------------------------------

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

echo "🌙 Renovate Schedule"

# Without the schedule, Renovate keeps running in every pipeline: a warning,
# never a failed init.
if ! schedules=$(glab api "projects/${PROJECT_PATH_ENCODED}/pipeline_schedules?scope=active" 2>&1); then
  echo "   ⚠️  Could not read the pipeline schedules, so Renovate keeps running in every pipeline."
  exit 0
fi
if printf '%s' "$schedules" | grep -q '"id"'; then
  echo "   ✅ The project already has a pipeline schedule: Renovate runs from it."
  exit 0
fi

project=$(glab api "projects/${PROJECT_PATH_ENCODED}" 2>/dev/null | strip_glab_noise)
id=$(echo "$project" | jq -r '.id')
branch=$(echo "$project" | jq -r '.default_branch // "main"')
minute=$((id % 60))
hour=$((2 + id / 60 % 3))

if glab api --method POST "projects/${PROJECT_PATH_ENCODED}/pipeline_schedules" \
  -f description=Renovate -f ref="${branch}" -f cron="${minute} ${hour} * * *" \
  -f cron_timezone=Europe/Paris -f active=true >/dev/null 2>&1; then
  echo "   ✅ Renovate now runs once a night, from the \"Renovate\" pipeline schedule."
else
  echo "   ⚠️  Could not create the \"Renovate\" schedule, so Renovate keeps running in every pipeline."
fi
