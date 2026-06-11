#!/bin/bash

# Install Taskfile

set -e

# shellcheck disable=SC1091
source "$TEMP_DIR/env_vars"

install_taskfile() {
  echo "Installing Taskfile..."
  # Retry/backoff/timeout: shared-runner egress to taskfile.dev intermittently
  # stalls; an unbounded curl then dies with exit 28 and kills the image build.
  sh -c "$(curl --location --retry 8 --retry-all-errors --retry-delay 5 --connect-timeout 15 --max-time 120 https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin

  echo "Taskfile installation completed."
}

install_taskfile
