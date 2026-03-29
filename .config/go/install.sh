#!/usr/bin/env sh
# Install Go if not already present

set -eu

log() { printf "%s\n" "$*"; }

if command -v go >/dev/null 2>&1; then
  log "go already installed: $(go version)"
  exit 0
fi

log "go not found. Installing..."

# Ensure root privileges for package installation
if [ "$(id -u)" -ne 0 ]; then
  if ! command -v sudo >/dev/null 2>&1 || ! sudo -n true 2>/dev/null; then
    log "sudo unavailable or blocked. Installing go via user-space tarball..."
    mkdir -p ~/.local/bin ~/.local/go
    if curl -fsSL https://go.dev/dl/go1.24.2.linux-amd64.tar.gz | tar -xz -C ~/.local/go --strip-components=1; then
      ln -sf ~/.local/go/bin/go ~/.local/bin/go
      ln -sf ~/.local/go/bin/gofmt ~/.local/bin/gofmt
      # Set GOPATH to ~/.local so `go install` puts binaries in ~/.local/bin (already in PATH)
      printf '\nexport GOROOT="%s/.local/go"\nexport GOPATH="%s/.local"\n' "$HOME" "$HOME" >>~/.bashrc
      log "Go user-space installation successful."
      exit 0
    else
      log "Error: Failed to download and extract Go tarball."
      exit 1
    fi
  fi
  log "Re-running with sudo..."
  sudo env PATH="$PATH" sh "$0"
  exit $?
fi

# Try to detect the package manager and install Go
if command -v apt-get >/dev/null 2>&1; then
  log "Detected: Debian/Ubuntu (apt-get)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq golang-go
elif command -v dnf >/dev/null 2>&1; then
  log "Detected: Fedora/RHEL (dnf)"
  dnf install -y golang
elif command -v yum >/dev/null 2>&1; then
  log "Detected: RHEL/CentOS (yum)"
  yum install -y golang
elif command -v microdnf >/dev/null 2>&1; then
  log "Detected: Fedora/RHEL (microdnf)"
  microdnf install -y golang
elif command -v apk >/dev/null 2>&1; then
  log "Detected: Alpine Linux (apk)"
  apk add --no-cache go
elif command -v pacman >/dev/null 2>&1; then
  log "Detected: Arch Linux (pacman)"
  pacman -Sy --noconfirm go
elif command -v zypper >/dev/null 2>&1; then
  log "Detected: openSUSE (zypper)"
  zypper --non-interactive refresh
  zypper --non-interactive install go
else
  log "Error: Unknown or unsupported package manager."
  exit 1
fi

# Verify installation
if command -v go >/dev/null 2>&1; then
  log "go installed successfully: $(go version)"
  # Determine the actual GOROOT (where Go was installed by the package manager)
  ACTUAL_GOROOT=$(dirname "$(dirname "$(readlink -f "$(which go)")")")
  log "Detected GOROOT: ${ACTUAL_GOROOT}"
  # Create symlink to /usr/local/go if Go was installed elsewhere
  # This ensures compatibility with tools expecting Go in /usr/local/go
  if [ "${ACTUAL_GOROOT}" != "/usr/local/go" ] && [ ! -e "/usr/local/go" ]; then
    log "Creating symlink: /usr/local/go -> ${ACTUAL_GOROOT}"
    ln -s "${ACTUAL_GOROOT}" /usr/local/go
  fi
  # Configure Go environment
  GOPATH="${HOME}/go"
  mkdir -p "${GOPATH}/bin"
  # Add Go environment to profile.d for all shells
  if [ -d "/etc/profile.d" ]; then
    log "Adding Go environment to /etc/profile.d/go.sh"
    cat >/etc/profile.d/go.sh <<EOF
# Go environment
export GOROOT=/usr/local/go
export GOPATH=\${HOME}/go
export PATH=\${PATH}:\${GOROOT}/bin:\${GOPATH}/bin
EOF
    chmod +x /etc/profile.d/go.sh
  fi
  log "GOROOT=/usr/local/go (symlinked to ${ACTUAL_GOROOT})"
  log "GOPATH=${GOPATH}"
else
  log "Error: Failed to install go."
  exit 1
fi
