#!/usr/bin/env sh
# gum installation script for Linux

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GUM_VERSION="${GUM_VERSION:-$(cat "$SCRIPT_DIR/version" 2>/dev/null)}"

if [ -z "$GUM_VERSION" ]; then
  echo "Error: Could not determine gum version."
  exit 1
fi

GUM_FORCE_UPDATE="${GUM_FORCE_UPDATE:-false}"

if command -v gum >/dev/null 2>&1; then
  if [ "$GUM_FORCE_UPDATE" = "true" ]; then
    echo "Force update requested. Reinstalling gum..."
  else
    echo "gum is already installed."
    exit 0
  fi
fi

echo "Installing gum v${GUM_VERSION}..."

ARCH=$(uname -m)
case "$ARCH" in
x86_64) GUM_ARCH="Linux_x86_64" ;;
aarch64 | arm64) GUM_ARCH="Linux_arm64" ;;
armv7l | armhf) GUM_ARCH="Linux_armv6" ;;
i386 | i686) GUM_ARCH="Linux_i386" ;;
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

DOWNLOAD_URL="https://github.com/charmbracelet/gum/releases/download/v${GUM_VERSION}/gum_${GUM_VERSION}_${GUM_ARCH}.tar.gz"
TMP_DIR=$(mktemp -d)

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$DOWNLOAD_URL" -o "$TMP_DIR/gum.tar.gz" || exit 1
elif command -v wget >/dev/null 2>&1; then
  wget -q "$DOWNLOAD_URL" -O "$TMP_DIR/gum.tar.gz" || exit 1
else
  echo "Neither curl nor wget found"
  exit 1
fi

tar -xzf "$TMP_DIR/gum.tar.gz" -C "$TMP_DIR"

INSTALL_DIR="${HOME}/.local/bin"
mkdir -p "$INSTALL_DIR"

if [ -f "$TMP_DIR/gum_${GUM_VERSION}_${GUM_ARCH}/gum" ]; then
  mv "$TMP_DIR/gum_${GUM_VERSION}_${GUM_ARCH}/gum" "$INSTALL_DIR/gum"
else
  find "$TMP_DIR" -type f -name "gum" -exec mv {} "$INSTALL_DIR/gum" \;
fi
chmod +x "$INSTALL_DIR/gum"
rm -rf "$TMP_DIR"

echo "gum installed to $INSTALL_DIR/gum"

if ! command -v gum >/dev/null 2>&1; then
  echo "Add ~/.local/bin to your PATH to use gum globally:"
  echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
fi
exit 0
