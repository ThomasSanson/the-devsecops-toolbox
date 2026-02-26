#!/usr/bin/env sh
# Generic jq installation for common Linux distributions (POSIX sh)

set -eu

log() { printf "%s\n" "$*"; }

log "Checking for jq..."
if command -v jq >/dev/null 2>&1; then
  log "jq is already installed."
  exit 0
fi

log "jq not found. Installing..."

# Try to detect the package manager and install jq
if command -v apt-get >/dev/null 2>&1; then
  # Debian/Ubuntu
  log "Detected: Debian/Ubuntu (apt-get)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y jq
elif command -v dnf >/dev/null 2>&1; then
  # Modern Fedora/RHEL
  log "Detected: Fedora/RHEL (dnf)"
  dnf install -y jq
elif command -v yum >/dev/null 2>&1; then
  # Legacy RHEL/CentOS
  log "Detected: RHEL/CentOS (yum)"
  yum install -y jq
elif command -v microdnf >/dev/null 2>&1; then
  # Minimal Fedora/RHEL images
  log "Detected: Fedora/RHEL (microdnf)"
  microdnf install -y jq
elif command -v apk >/dev/null 2>&1; then
  # Alpine Linux
  log "Detected: Alpine Linux (apk)"
  apk add --no-cache jq
elif command -v pacman >/dev/null 2>&1; then
  # Arch Linux
  log "Detected: Arch Linux (pacman)"
  pacman -Sy --noconfirm jq
elif command -v zypper >/dev/null 2>&1; then
  # openSUSE
  log "Detected: openSUSE (zypper)"
  zypper --non-interactive refresh
  zypper --non-interactive install jq
else
  log "Error: Unknown or unsupported package manager."
  exit 1
fi

# Verify installation
if command -v jq >/dev/null 2>&1; then
  log "jq installed successfully!"
else
  log "Error: Failed to install jq."
  exit 1
fi
