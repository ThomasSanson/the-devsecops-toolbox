#!/bin/bash

# Setup Docker

set -e

# shellcheck disable=SC1091
source "$TEMP_DIR/env_vars"

setup_docker() {
  local USER="$1"

  echo "Configuring Docker..."
  sudo usermod -aG docker "$USER"

  echo "Docker configuration completed."
}

setup_docker "$1" "$2"
