#!/usr/bin/env sh
# glab (GitLab CLI) installation script for Linux
# Supports multiple installation methods with fallbacks

set -eu

GLAB_VERSION="${GLAB_VERSION:-1.52.0}"
GLAB_FORCE_UPDATE="${GLAB_FORCE_UPDATE:-false}"

log() { printf "%s\n" "$*"; }

# Check if glab is already installed and skip unless forced
if command -v glab >/dev/null 2>&1; then
  if [ "$GLAB_FORCE_UPDATE" = "true" ]; then
    log "Force update requested. Reinstalling glab..."
  else
    log "glab is already installed."
    glab --version
    exit 0
  fi
fi

log "Installing glab v${GLAB_VERSION}..."

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
x86_64)
  GLAB_ARCH="linux_amd64"
  ;;
aarch64 | arm64)
  GLAB_ARCH="linux_arm64"
  ;;
armv7l | armhf)
  GLAB_ARCH="linux_armv6"
  ;;
i386 | i686)
  GLAB_ARCH="linux_386"
  ;;
*)
  log "Unsupported architecture: $ARCH"
  exit 1
  ;;
esac

# Method 1: Direct binary download from GitHub releases
install_from_github() {
  log "Attempting installation from GitHub releases..."

  DOWNLOAD_URL="https://gitlab.com/gitlab-org/cli/-/releases/v${GLAB_VERSION}/downloads/glab_${GLAB_VERSION}_${GLAB_ARCH}.tar.gz"
  TMP_DIR=$(mktemp -d)

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$DOWNLOAD_URL" -o "$TMP_DIR/glab.tar.gz" || return 1
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$DOWNLOAD_URL" -O "$TMP_DIR/glab.tar.gz" || return 1
  else
    log "Neither curl nor wget found"
    return 1
  fi

  tar -xzf "$TMP_DIR/glab.tar.gz" -C "$TMP_DIR"

  # Install to /usr/local/bin if writable, otherwise to ~/.local/bin
  if [ -w /usr/local/bin ]; then
    INSTALL_DIR="/usr/local/bin"
  else
    INSTALL_DIR="${HOME}/.local/bin"
    mkdir -p "$INSTALL_DIR"
  fi

  mv "$TMP_DIR/bin/glab" "$INSTALL_DIR/glab"
  chmod +x "$INSTALL_DIR/glab"
  rm -rf "$TMP_DIR"

  log "glab installed to $INSTALL_DIR/glab"
  return 0
}

# Method 2: Homebrew (if available)
install_from_homebrew() {
  if command -v brew >/dev/null 2>&1; then
    log "Attempting installation via Homebrew..."
    brew install glab && return 0
  fi
  return 1
}

# Method 3: Package manager (apt/dnf/yum)
install_from_package_manager() {
  if command -v apt-get >/dev/null 2>&1; then
    log "Attempting installation via apt..."
    # Add GitLab repository and install
    curl -fsSL "https://gitlab.com/gitlab-org/cli/-/raw/main/scripts/install.sh" | sh || true
    # Verify glab was actually installed
    if command -v glab >/dev/null 2>&1 || [ -x "${HOME}/.local/bin/glab" ]; then
      return 0
    fi
  fi
  return 1
}

# Try installation methods in order
if install_from_github; then
  log "✅ glab installed successfully via GitHub releases"
elif install_from_homebrew; then
  log "✅ glab installed successfully via Homebrew"
elif install_from_package_manager; then
  log "✅ glab installed successfully via package manager"
else
  log "❌ Failed to install glab. Please install manually from:"
  log "   https://gitlab.com/gitlab-org/cli/-/releases"
  exit 1
fi

# Verify installation
if command -v glab >/dev/null 2>&1; then
  log ""
  log "Installation complete!"
  glab --version
else
  # Check if installed in ~/.local/bin but not in PATH
  if [ -x "${HOME}/.local/bin/glab" ]; then
    log ""
    log "glab installed to ~/.local/bin/glab"
    log "Add ~/.local/bin to your PATH to use glab globally:"
    # shellcheck disable=SC2016
    log '  export PATH="$HOME/.local/bin:$PATH"'
    "${HOME}/.local/bin/glab" --version
    exit 0
  else
    log "❌ Installation verification failed"
    exit 1
  fi
fi
