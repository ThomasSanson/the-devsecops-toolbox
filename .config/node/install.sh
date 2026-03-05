#!/usr/bin/env sh
# Install Node.js if not already present

set -eu

log() { printf "%s\n" "$*"; }

retry_cmd() {
  cmd="$1"
  max_attempts="${2:-5}"
  retry_delay_seconds="${3:-5}"
  attempt=1

  while [ "$attempt" -le "$max_attempts" ]; do
    if sh -c "$cmd"; then
      return 0
    fi

    if [ "$attempt" -lt "$max_attempts" ]; then
      log "Attempt ${attempt}/${max_attempts} failed. Retrying in ${retry_delay_seconds}s: ${cmd}"
      sleep "$retry_delay_seconds"
    fi

    attempt=$((attempt + 1))
  done

  log "Error: Command failed after ${max_attempts} attempts: ${cmd}"
  return 1
}

install_node_from_nodesource() {
  rm -rf /var/lib/apt/lists/*
  if ! retry_cmd "apt-get update -qq"; then
    return 1
  fi

  if ! retry_cmd "apt-get install -y -qq nodejs"; then
    return 1
  fi

  return 0
}

install_node_from_distro_repo() {
  log "NodeSource repository install failed after retries. Falling back to distro packages."
  rm -f /etc/apt/sources.list.d/nodesource.list
  rm -f /etc/apt/keyrings/nodesource.gpg
  rm -rf /var/lib/apt/lists/*
  if ! retry_cmd "apt-get update -qq"; then
    return 1
  fi

  if ! retry_cmd "apt-get install -y -qq nodejs npm"; then
    return 1
  fi

  return 0
}

if command -v node >/dev/null 2>&1; then
  log "node already installed: $(node --version)"
  exit 0
fi

log "node not found. Installing..."

# Try to detect the package manager and install node
if command -v apt-get >/dev/null 2>&1; then
  # Debian/Ubuntu - Install Node.js 20.x LTS via NodeSource
  log "Detected: Debian/Ubuntu (apt-get)"
  export DEBIAN_FRONTEND=noninteractive
  rm -rf /var/lib/apt/lists/*
  retry_cmd "apt-get update -qq"
  retry_cmd "apt-get install -y -qq ca-certificates curl gnupg"

  # Add NodeSource repository for Node.js 20.x
  mkdir -p /etc/apt/keyrings
  retry_cmd "curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o /tmp/nodesource-repo.gpg.key"
  gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg /tmp/nodesource-repo.gpg.key
  rm -f /tmp/nodesource-repo.gpg.key
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list >/dev/null

  if ! install_node_from_nodesource; then
    install_node_from_distro_repo
  fi
elif command -v dnf >/dev/null 2>&1; then
  # Modern Fedora/RHEL
  log "Detected: Fedora/RHEL (dnf)"
  dnf install -y nodejs npm
elif command -v yum >/dev/null 2>&1; then
  # Legacy RHEL/CentOS
  log "Detected: RHEL/CentOS (yum)"
  yum install -y nodejs npm
elif command -v apk >/dev/null 2>&1; then
  # Alpine Linux
  log "Detected: Alpine Linux (apk)"
  apk add --no-cache nodejs npm
elif command -v pacman >/dev/null 2>&1; then
  # Arch Linux
  log "Detected: Arch Linux (pacman)"
  pacman -Sy --noconfirm nodejs npm
elif command -v zypper >/dev/null 2>&1; then
  # openSUSE
  log "Detected: openSUSE (zypper)"
  zypper --non-interactive refresh
  zypper --non-interactive install nodejs npm
else
  log "Error: Unknown or unsupported package manager."
  exit 1
fi

# Verify installation
if command -v node >/dev/null 2>&1; then
  log "node installed successfully: $(node --version)"
else
  log "Error: Failed to install node."
  exit 1
fi

if command -v npm >/dev/null 2>&1; then
  log "npm installed successfully: $(npm --version)"
else
  log "Error: Failed to install npm."
  exit 1
fi
