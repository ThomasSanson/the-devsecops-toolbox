#!/usr/bin/env sh
# glow installation script for Linux

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GLOW_VERSION="${GLOW_VERSION:-$(cat "$SCRIPT_DIR/version" 2>/dev/null)}"

if [ -z "$GLOW_VERSION" ]; then
  echo "Error: Could not determine glow version."
  exit 1
fi

GLOW_FORCE_UPDATE="${GLOW_FORCE_UPDATE:-false}"

if command -v glow >/dev/null 2>&1; then
  if [ "$GLOW_FORCE_UPDATE" = "true" ]; then
    echo "Force update requested. Reinstalling glow..."
  else
    echo "glow is already installed."
    exit 0
  fi
fi

echo "Installing glow v${GLOW_VERSION}..."

ARCH=$(uname -m)
case "$ARCH" in
x86_64) GLOW_ARCH="Linux_x86_64" ;;
aarch64 | arm64) GLOW_ARCH="Linux_arm64" ;;
armv7l | armhf) GLOW_ARCH="Linux_armv6" ;;
i386 | i686) GLOW_ARCH="Linux_i386" ;;
*)
  echo "Unsupported architecture: $ARCH"
  exit 1
  ;;
esac

if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
  echo "Neither curl nor wget found. Trying to install curl..."
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq && apt-get install -y curl
  fi
fi

# glow release naming changed slightly between versions but for 2.1.1 this should work
DOWNLOAD_URL="https://github.com/charmbracelet/glow/releases/download/v${GLOW_VERSION}/glow_${GLOW_VERSION}_${GLOW_ARCH}.tar.gz"
TMP_DIR=$(mktemp -d)

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$DOWNLOAD_URL" -o "$TMP_DIR/glow.tar.gz" || exit 1
elif command -v wget >/dev/null 2>&1; then
  wget -q "$DOWNLOAD_URL" -O "$TMP_DIR/glow.tar.gz" || exit 1
else
  echo "Neither curl nor wget found"
  exit 1
fi

tar -xzf "$TMP_DIR/glow.tar.gz" -C "$TMP_DIR"

INSTALL_DIR="${HOME}/.local/bin"
mkdir -p "$INSTALL_DIR"

if [ -f "$TMP_DIR/glow_${GLOW_VERSION}_${GLOW_ARCH}/glow" ]; then
  mv "$TMP_DIR/glow_${GLOW_VERSION}_${GLOW_ARCH}/glow" "$INSTALL_DIR/glow"
else
  find "$TMP_DIR" -type f -name "glow" -exec mv {} "$INSTALL_DIR/glow" \;
fi
chmod +x "$INSTALL_DIR/glow"
rm -rf "$TMP_DIR"

echo "glow installed to $INSTALL_DIR/glow"

if ! command -v glow >/dev/null 2>&1; then
  echo "Add ~/.local/bin to your PATH to use glow globally:"
  echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
fi
exit 0
