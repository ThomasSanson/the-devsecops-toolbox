#!/usr/bin/env sh
# jq installation script - downloads static binary from GitHub releases
# No root/sudo required

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
JQ_VERSION="${JQ_VERSION:-$(cat "$SCRIPT_DIR/version" 2>/dev/null)}"

log() { printf "%s\n" "$*"; }

if [ -z "$JQ_VERSION" ]; then
  log "Error: Could not determine jq version. Check .config/jq/version file."
  exit 1
fi

log "Checking for jq..."
if command -v jq >/dev/null 2>&1; then
  log "jq is already installed."
  jq --version
  exit 0
fi

log "Installing jq v${JQ_VERSION}..."

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
x86_64)
  JQ_ARCH="amd64"
  ;;
aarch64 | arm64)
  JQ_ARCH="arm64"
  ;;
armv7l | armhf)
  JQ_ARCH="armhf"
  ;;
i386 | i686)
  JQ_ARCH="i386"
  ;;
*)
  log "Unsupported architecture: $ARCH"
  exit 1
  ;;
esac

# Detect OS
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$OS" in
linux)
  JQ_OS="linux"
  ;;
darwin)
  JQ_OS="macos"
  ;;
*)
  log "Unsupported OS: $OS"
  exit 1
  ;;
esac

DOWNLOAD_URL="https://github.com/jqlang/jq/releases/download/jq-${JQ_VERSION}/jq-${JQ_OS}-${JQ_ARCH}"

# Ensure a download tool is available
if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
  log "Neither curl nor wget found. Installing wget..."
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq && apt-get install -y -qq wget
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache wget
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y wget
  elif command -v yum >/dev/null 2>&1; then
    yum install -y wget
  else
    log "Error: No download tool available and cannot install one"
    exit 1
  fi
fi

# Download binary
TMP_DIR=$(mktemp -d)
log "Downloading from ${DOWNLOAD_URL}..."

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$DOWNLOAD_URL" -o "$TMP_DIR/jq" || {
    log "Error: Download failed"
    rm -rf "$TMP_DIR"
    exit 1
  }
elif command -v wget >/dev/null 2>&1; then
  wget -q "$DOWNLOAD_URL" -O "$TMP_DIR/jq" || {
    log "Error: Download failed"
    rm -rf "$TMP_DIR"
    exit 1
  }
else
  log "Error: Neither curl nor wget found"
  rm -rf "$TMP_DIR"
  exit 1
fi

# Install to /usr/local/bin if writable, otherwise to ~/.local/bin
if [ -w /usr/local/bin ]; then
  INSTALL_DIR="/usr/local/bin"
else
  INSTALL_DIR="${HOME}/.local/bin"
  mkdir -p "$INSTALL_DIR"
fi

mv "$TMP_DIR/jq" "$INSTALL_DIR/jq"
chmod +x "$INSTALL_DIR/jq"
rm -rf "$TMP_DIR"

# Verify installation
if command -v jq >/dev/null 2>&1; then
  log "jq installed successfully to $INSTALL_DIR/jq"
  jq --version
elif [ -x "$INSTALL_DIR/jq" ]; then
  log "jq installed to $INSTALL_DIR/jq"
  log "Add $INSTALL_DIR to your PATH to use jq globally:"
  # shellcheck disable=SC2016
  log '  export PATH="$HOME/.local/bin:$PATH"'
  "$INSTALL_DIR/jq" --version
  exit 0
else
  log "Error: Failed to install jq."
  exit 1
fi
