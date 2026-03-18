#!/usr/bin/env sh
# Generic git installation for common Linux distributions (POSIX sh)

set -eu

log() { printf "%s\n" "$*"; }

log "Checking for git..."
if command -v git >/dev/null 2>&1; then
  log "git is already installed."
  exit 0
fi

log "git not found. Installing..."

# Ensure root privileges for package installation
if [ "$(id -u)" -ne 0 ]; then
  if ! command -v sudo >/dev/null 2>&1; then
    log "Error: root privileges required but sudo is not available."
    exit 1
  fi
  log "Re-running with sudo..."
  sudo env PATH="$PATH" sh "$0"
  exit $?
fi

# Try to detect the package manager and install git
if command -v apt-get >/dev/null 2>&1; then
  # Debian/Ubuntu
  log "Detected: Debian/Ubuntu (apt-get)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y git
elif command -v dnf >/dev/null 2>&1; then
  # Modern Fedora/RHEL
  log "Detected: Fedora/RHEL (dnf)"
  dnf install -y git
elif command -v yum >/dev/null 2>&1; then
  # Legacy RHEL/CentOS
  log "Detected: RHEL/CentOS (yum)"
  yum install -y git
elif command -v microdnf >/dev/null 2>&1; then
  # Minimal Fedora/RHEL images
  log "Detected: Fedora/RHEL (microdnf)"
  microdnf install -y git
elif command -v apk >/dev/null 2>&1; then
  # Alpine Linux
  log "Detected: Alpine Linux (apk)"
  apk add --no-cache git
elif command -v pacman >/dev/null 2>&1; then
  # Arch Linux
  log "Detected: Arch Linux (pacman)"
  pacman -Sy --noconfirm git
elif command -v zypper >/dev/null 2>&1; then
  # openSUSE
  log "Detected: openSUSE (zypper)"
  zypper --non-interactive refresh
  zypper --non-interactive install git
else
  log "Error: Unknown or unsupported package manager."
  exit 1
fi

# Verify installation
if command -v git >/dev/null 2>&1; then
  log "git installed successfully!"
else
  log "Error: Failed to install git."
  exit 1
fi
