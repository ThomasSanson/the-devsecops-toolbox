#!/usr/bin/env bash
# Install Node.js via nvm at the pinned version (read from ./version file).
#
# nvm is intentionally user-level: it installs into $HOME/.nvm and does not
# require sudo. If this script is invoked as root (e.g. first Docker build
# pass), it returns early — Node is installed in the subsequent user pass.

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_VERSION="${NODE_VERSION:-$(cat "$SCRIPT_DIR/version" 2>/dev/null)}"
NVM_VERSION="${NVM_VERSION:-v0.40.1}"

log() { printf "%s\n" "$*"; }

if [ -z "$NODE_VERSION" ]; then
  log "Error: Could not determine node version. Check .config/node/version file."
  exit 1
fi

if [ "$(id -u)" -eq 0 ]; then
  log "Skipping node install: running as root. nvm will be installed in the user pass."
  exit 0
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

# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

if nvm ls "$NODE_VERSION" >/dev/null 2>&1; then
  log "node ${NODE_VERSION} already installed via nvm."
else
  log "Installing node ${NODE_VERSION} via nvm..."
  nvm install "$NODE_VERSION"
fi

nvm alias default "$NODE_VERSION" >/dev/null
nvm use default >/dev/null

log "node installed successfully: $(node --version)"
log "npm installed successfully: $(npm --version)"
