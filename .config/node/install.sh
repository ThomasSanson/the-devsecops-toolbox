#!/usr/bin/env bash
# Install Node.js via nvm at the pinned version (read from ./version file).
#
# nvm installs into $HOME/.nvm — when invoked as root that's /root/.nvm,
# when invoked as a regular user that's /home/<user>/.nvm. Both work; the
# Dockerfile may run this script once per pass (root then user), producing
# one installation per target user.
#
# After installing Node, symlinks to node/npm/npx are created in
# $HOME/.local/bin so they are visible to sibling Taskfile subshells (which
# do not source nvm.sh).

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_VERSION="${NODE_VERSION:-$(cat "$SCRIPT_DIR/version" 2>/dev/null)}"
NVM_VERSION="${NVM_VERSION:-v0.40.1}"

log() { printf "%s\n" "$*"; }

if [ -z "$NODE_VERSION" ]; then
  log "Error: Could not determine node version. Check .config/node/version file."
  exit 1
fi

retry_cmd() {
  cmd="$1"
  max_attempts="${2:-5}"
  retry_delay_seconds="${3:-5}"
  attempt=1

  while [ "$attempt" -le "$max_attempts" ]; do
    if bash -c "$cmd"; then
      return 0
    fi

    if [ "$attempt" -lt "$max_attempts" ]; then
      log "Attempt ${attempt}/${max_attempts} failed. Retrying in ${retry_delay_seconds}s: ${cmd}"
      sleep "$retry_delay_seconds"
    fi

    attempt=$((attempt + 1))
  done

  log "Error: Command failed after ${max_attempts} attempts: ${cmd}"
  return 1
}

# nvm install fetches node-*.tar.xz; xz-utils must be present.
if ! command -v xz >/dev/null 2>&1; then
  log "xz not found; installing xz-utils..."
  if command -v apt-get >/dev/null 2>&1; then
    if [ "$(id -u)" -eq 0 ]; then
      DEBIAN_FRONTEND=noninteractive apt-get update -qq
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xz-utils
    elif command -v sudo >/dev/null 2>&1; then
      sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
      sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xz-utils
    else
      log "Warning: xz missing and cannot be auto-installed (no sudo/apt-get). nvm install may fail."
    fi
  else
    log "Warning: xz missing and apt-get unavailable. nvm install may fail."
  fi
fi

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  log "nvm not found. Installing nvm ${NVM_VERSION}..."
  NVM_INSTALLER_URL="https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh"
  if ! retry_cmd "curl -fsSL '${NVM_INSTALLER_URL}' -o /tmp/nvm-install.sh"; then
    log "Error: Failed to download nvm installer."
    exit 1
  fi
  bash /tmp/nvm-install.sh >/dev/null
  rm -f /tmp/nvm-install.sh
fi

# nvm.sh expects some vars to exist; relax -u while sourcing.
set +u
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
set -u

if nvm ls "$NODE_VERSION" >/dev/null 2>&1; then
  log "node ${NODE_VERSION} already installed via nvm."
else
  log "Installing node ${NODE_VERSION} via nvm..."
  nvm install "$NODE_VERSION"
fi

nvm alias default "$NODE_VERSION" >/dev/null
nvm use default >/dev/null

# Expose node/npm/npx to sibling Taskfile subshells via $HOME/.local/bin,
# which is on PATH in every shell that task spawns. Without these symlinks,
# `command -v npm` returns false in tasks like :commitlint:install because
# nvm.sh is only sourced in the shell that ran this installer.
NODE_BIN_DIR="$(dirname "$(nvm which "$NODE_VERSION")")"
mkdir -p "$HOME/.local/bin"
ln -sf "$NODE_BIN_DIR/node" "$HOME/.local/bin/node"
ln -sf "$NODE_BIN_DIR/npm" "$HOME/.local/bin/npm"
ln -sf "$NODE_BIN_DIR/npx" "$HOME/.local/bin/npx"

log "node installed successfully: $(node --version)"
log "npm installed successfully: $(npm --version)"
