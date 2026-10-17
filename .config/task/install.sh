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
# Retry/backoff/timeout flags: shared-runner egress to Cloudflare-fronted
# hosts (taskfile.dev) intermittently stalls; an unbounded curl then hangs
# until the job timeout (observed as exit 28 killing CI builds).
CURL_FLAGS="--location --retry 8 --retry-all-errors --retry-delay 5 --connect-timeout 15 --max-time 120"
BIN_DIR=/usr/local/bin
INSTALL_CMD="sh -c \"\$(curl $CURL_FLAGS https://taskfile.dev/install.sh)\" -- -d -b \"\$BIN_DIR\" \"v${TASK_VERSION}\""
if [ -w "$BIN_DIR" ]; then
  eval "$INSTALL_CMD"
elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  # shellcheck disable=SC2086
  sudo -n sh -c "$(curl $CURL_FLAGS https://taskfile.dev/install.sh)" -- -d -b "$BIN_DIR" "v${TASK_VERSION}"
else
  BIN_DIR="${HOME}/.local/bin"
  log "Warning: /usr/local/bin not writable and no passwordless sudo. Installing into ${BIN_DIR} instead..."
  mkdir -p "$BIN_DIR"
  eval "$INSTALL_CMD"
fi

if [ -x "$BIN_DIR/task" ]; then
  log "Taskfile installed successfully in ${BIN_DIR}: $("$BIN_DIR/task" --version)"
  if [ "$BIN_DIR" != /usr/local/bin ]; then
    log "${BIN_DIR} must be on your PATH, before any other folder with a task in it:"
    log "  export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi
else
  log "Error: Taskfile installation failed."
  exit 1
fi
