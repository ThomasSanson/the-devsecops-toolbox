#!/usr/bin/env sh
# Install glab (GitLab CLI) using official installation methods
# Reference: https://gitlab.com/gitlab-org/cli#installation
#
# Environment variables:
#   GLAB_FORCE_UPDATE=true  - Force reinstallation even if glab is already installed

set -eu

log() { printf "%s\n" "$*"; }

FORCE_UPDATE="${GLAB_FORCE_UPDATE:-false}"

log "Checking for glab..."
if command -v glab >/dev/null 2>&1; then
  if [ "$FORCE_UPDATE" = "true" ]; then
    log "glab is installed: $(glab --version)"
    log "Force update requested, reinstalling..."
  else
    log "glab is already installed: $(glab --version)"
    exit 0
  fi
else
  log "glab not found. Installing..."
fi

# Method 1: Download binary release for Linux (most reliable)
if [ "$(uname -s)" = "Linux" ]; then
  log "Detected: Linux, downloading binary release"

  # Determine architecture
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64) ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) log "Error: Unsupported architecture: $ARCH"; exit 1 ;;
  esac

  # Get latest version from GitLab API
  GLAB_VERSION=$(curl -s "https://gitlab.com/api/v4/projects/34675721/releases" | grep -oP '"tag_name":"v\K[^"]+' | head -1)

  if [ -z "$GLAB_VERSION" ]; then
    log "Error: Could not determine latest glab version"
    exit 1
  fi

  log "Installing glab version $GLAB_VERSION for linux $ARCH"

  # Official download URL format: glab_VERSION_linux_ARCH.tar.gz
  DOWNLOAD_URL="https://gitlab.com/gitlab-org/cli/-/releases/v${GLAB_VERSION}/downloads/glab_${GLAB_VERSION}_linux_${ARCH}.tar.gz"

  log "Downloading from: $DOWNLOAD_URL"

  # Download and extract
  TMP_DIR=$(mktemp -d)
  if ! curl -fsSL "$DOWNLOAD_URL" -o "$TMP_DIR/glab.tar.gz"; then
    log "Error: Failed to download glab"
    rm -rf "$TMP_DIR"
    exit 1
  fi

  tar -xzf "$TMP_DIR/glab.tar.gz" -C "$TMP_DIR"

  # Find the glab binary (could be at root or in bin/)
  if [ -f "$TMP_DIR/bin/glab" ]; then
    GLAB_BIN="$TMP_DIR/bin/glab"
  elif [ -f "$TMP_DIR/glab" ]; then
    GLAB_BIN="$TMP_DIR/glab"
  else
    log "Error: Could not find glab binary in archive"
    ls -la "$TMP_DIR"
    rm -rf "$TMP_DIR"
    exit 1
  fi

  # Install to /usr/local/bin or user's bin
  if [ -w /usr/local/bin ]; then
    mv "$GLAB_BIN" /usr/local/bin/glab
    chmod +x /usr/local/bin/glab
  elif [ -d "$HOME/.local/bin" ]; then
    mv "$GLAB_BIN" "$HOME/.local/bin/glab"
    chmod +x "$HOME/.local/bin/glab"
    log "Note: Ensure $HOME/.local/bin is in your PATH"
  else
    mkdir -p "$HOME/.local/bin"
    mv "$GLAB_BIN" "$HOME/.local/bin/glab"
    chmod +x "$HOME/.local/bin/glab"
    log "Note: Ensure $HOME/.local/bin is in your PATH"
  fi

  # Cleanup
  rm -rf "$TMP_DIR"

  if command -v glab >/dev/null 2>&1; then
    log "glab installed successfully: $(glab --version)"
    exit 0
  fi

  log "glab binary installed. You may need to update your PATH."
  exit 0
fi

# Method 2: Use Homebrew if available (macOS or Linuxbrew)
if command -v brew >/dev/null 2>&1; then
  log "Detected: Homebrew, using 'brew install'"
  if [ "$FORCE_UPDATE" = "true" ]; then
    brew upgrade glab || brew install glab
  else
    brew install glab
  fi

  if command -v glab >/dev/null 2>&1; then
    log "glab installed successfully via Homebrew: $(glab --version)"
    exit 0
  fi
fi

log "Error: Could not install glab."
log "Please install manually: https://gitlab.com/gitlab-org/cli#installation"
exit 1
