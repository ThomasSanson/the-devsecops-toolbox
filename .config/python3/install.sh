#!/usr/bin/env sh
# Install Python3 if not already present

set -eu

log() { printf "%s\n" "$*"; }

PYTHON_VERSION_FILE=".config/python/.python-version"
PYTHON_VERSION="$(cat "$PYTHON_VERSION_FILE")"
PYTHON_BIN="python${PYTHON_VERSION}"
UV_PYTHON_INSTALL_DIR="/opt/uv/python"
IS_ROOT=0

if [ "$(id -u)" -eq 0 ]; then
  IS_ROOT=1
fi

python3_major_minor() {
  python3 -c 'import sys; print(str(sys.version_info[0]) + "." + str(sys.version_info[1]))'
}

ensure_uv_installed() {
  if command -v uv >/dev/null 2>&1; then
    return 0
  fi

  log "uv not found. Installing uv to bootstrap Python ${PYTHON_VERSION}..."
  .config/uv/install.sh
}

install_declared_python_with_uv() {
  ensure_uv_installed

  log "Installing Python ${PYTHON_VERSION} with uv..."
  mkdir -p "$UV_PYTHON_INSTALL_DIR"
  export UV_PYTHON_INSTALL_DIR
  uv python install --install-dir "$UV_PYTHON_INSTALL_DIR" "$PYTHON_VERSION"

  UV_PYTHON_PATH="$(uv python find "$PYTHON_VERSION")"
  if [ -z "$UV_PYTHON_PATH" ] || [ ! -x "$UV_PYTHON_PATH" ]; then
    log "Error: unable to locate ${PYTHON_BIN} after uv installation."
    exit 1
  fi

  ln -sf "$UV_PYTHON_PATH" "/usr/local/bin/$PYTHON_BIN"
}

if command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  CURRENT_PYTHON_BIN_PATH="$(command -v "$PYTHON_BIN")"

  if [ "$IS_ROOT" -eq 1 ] && printf '%s' "$CURRENT_PYTHON_BIN_PATH" | grep -q '^/root/'; then
    install_declared_python_with_uv
  fi

  log "${PYTHON_BIN} already installed: $($PYTHON_BIN --version 2>&1)"
  exit 0
fi

if command -v python3 >/dev/null 2>&1; then
  if [ "$(python3_major_minor)" = "$PYTHON_VERSION" ]; then
    log "python3 already installed with requested version: $(python3 --version)"
    exit 0
  fi

  log "python3 is installed but does not match requested version ${PYTHON_VERSION}: $(python3 --version)"
fi

if [ "$IS_ROOT" -ne 1 ]; then
  if ! command -v sudo >/dev/null 2>&1 || ! sudo -n true 2>/dev/null; then
    log "sudo unavailable or blocked. Installing Python ${PYTHON_VERSION} via uv in user space..."
    export PATH="$HOME/.local/bin:$PATH"
    ensure_uv_installed
    uv python install "$PYTHON_VERSION"
    exit 0
  fi

  log "Re-running Python ${PYTHON_VERSION} installation with sudo..."
  sudo env PATH="$PATH" sh "$0"

  if command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    log "${PYTHON_BIN} installed successfully: $($PYTHON_BIN --version 2>&1)"
    exit 0
  fi

  log "Error: ${PYTHON_BIN} is still unavailable after sudo installation."
  exit 1
fi

log "Installing Python ${PYTHON_VERSION}..."

# Install Python3 via apt-get (Ubuntu/Debian)
if command -v apt-get >/dev/null 2>&1; then
  log "Detected: Debian/Ubuntu (apt-get)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq

  if apt-cache show "$PYTHON_BIN" >/dev/null 2>&1; then
    apt-get install -y -qq python3 "$PYTHON_BIN"
  else
    if ! command -v python3 >/dev/null 2>&1; then
      log "Requested package ${PYTHON_BIN} is not available via apt-get. Installing python3 bootstrap runtime first."
      apt-get install -y -qq python3
    fi

    log "Requested package ${PYTHON_BIN} is not available via apt-get. Falling back to uv for the declared version."
    install_declared_python_with_uv
  fi
else
  log "Error: apt-get not found. Only Debian/Ubuntu is supported."
  exit 1
fi

# Verify installation
if command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  log "${PYTHON_BIN} installed successfully: $($PYTHON_BIN --version 2>&1)"
else
  log "Error: ${PYTHON_BIN} installation failed."
  exit 1
fi
