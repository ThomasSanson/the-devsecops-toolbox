#!/usr/bin/env sh
# Install UV if not already present

set -eu

log() { printf "%s\n" "$*"; }

if command -v uv >/dev/null 2>&1; then
  log "UV already installed: $(uv --version)"
  exit 0
fi

log "UV not found. Installing..."

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
