#!/usr/bin/env sh
# Install Taskfile at a pinned version (read from ./version file)

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TASK_VERSION="${TASK_VERSION:-$(cat "$SCRIPT_DIR/version" 2>/dev/null)}"

log() { printf "%s\n" "$*"; }

if [ -z "$TASK_VERSION" ]; then
  log "Error: Could not determine task version. Check .config/task/version file."
  exit 1
fi

if command -v task >/dev/null 2>&1; then
  CURRENT="$(task --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
  if [ "$CURRENT" = "$TASK_VERSION" ]; then
    log "Taskfile already installed at pinned version: $CURRENT"
    exit 0
  fi
  log "Taskfile $CURRENT found, but pinned version is v$TASK_VERSION. Reinstalling..."

  # Remove existing binary if not writable (e.g. installed as root in Docker image)
  TASK_BIN="$(command -v task)"
  if [ -n "$TASK_BIN" ] && [ ! -w "$TASK_BIN" ]; then
    if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
      log "Removing existing binary with sudo: $TASK_BIN"
      sudo -n rm -f "$TASK_BIN"
    else
      log "Warning: Cannot remove $TASK_BIN (no passwordless sudo). Trying install anyway..."
    fi
  fi
fi

log "Installing Taskfile v${TASK_VERSION}..."
sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin "v${TASK_VERSION}"

if command -v task >/dev/null 2>&1; then
  log "Taskfile installed successfully: $(task --version)"
else
  log "Error: Taskfile installation failed."
  exit 1
fi
