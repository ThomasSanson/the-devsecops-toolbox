#!/usr/bin/env sh
# Install UV if not already present

set -eu

log() { printf "%s\n" "$*"; }

if command -v uv >/dev/null 2>&1; then
  log "UV already installed: $(uv --version)"
  exit 0
fi

log "UV not found. Installing..."

# Ensure root privileges for installation to /usr/local/bin
if [ "$(id -u)" -ne 0 ]; then
  if ! command -v sudo >/dev/null 2>&1; then
    log "Error: root privileges required but sudo is not available."
    exit 1
  fi
  log "Re-running with sudo..."
  sudo env PATH="$PATH" sh "$0"
  exit $?
fi

# Install UV binary from official script
curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh

# Verify installation
if command -v uv >/dev/null 2>&1; then
  log "UV installed successfully: $(uv --version)"
else
  log "Error: UV installation failed."
  exit 1
fi

uv python install "$(cat .config/python/.python-version)"
