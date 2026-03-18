#!/usr/bin/env sh
# Install Docker CLI if not already present

set -eu

log() { printf "%s\n" "$*"; }

if command -v docker >/dev/null 2>&1; then
  log "docker already installed: $(docker --version)"
  exit 0
fi

log "docker not found. Installing..."

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

# Try to detect the package manager and install docker
if command -v apt-get >/dev/null 2>&1; then
  # Debian/Ubuntu
  log "Detected: Debian/Ubuntu (apt-get)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list >/dev/null
  apt-get update -qq
  apt-get install -y -qq docker-ce-cli docker-buildx-plugin docker-compose-plugin
elif command -v dnf >/dev/null 2>&1; then
  # Modern Fedora/RHEL
  log "Detected: Fedora/RHEL (dnf)"
  dnf install -y dnf-plugins-core
  dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
  dnf install -y docker-ce-cli docker-buildx-plugin docker-compose-plugin
elif command -v yum >/dev/null 2>&1; then
  # Legacy RHEL/CentOS
  log "Detected: RHEL/CentOS (yum)"
  yum install -y yum-utils
  yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
  yum install -y docker-ce-cli docker-buildx-plugin docker-compose-plugin
elif command -v apk >/dev/null 2>&1; then
  # Alpine Linux
  log "Detected: Alpine Linux (apk)"
  apk add --no-cache docker-cli docker-cli-buildx docker-cli-compose
elif command -v pacman >/dev/null 2>&1; then
  # Arch Linux
  log "Detected: Arch Linux (pacman)"
  pacman -Sy --noconfirm docker docker-buildx docker-compose
elif command -v zypper >/dev/null 2>&1; then
  # openSUSE
  log "Detected: openSUSE (zypper)"
  zypper --non-interactive refresh
  zypper --non-interactive install docker
else
  log "Error: Unknown or unsupported package manager."
  exit 1
fi

# Verify installation
if command -v docker >/dev/null 2>&1; then
  log "docker installed successfully: $(docker --version)"
else
  log "Error: Failed to install docker."
  exit 1
fi
