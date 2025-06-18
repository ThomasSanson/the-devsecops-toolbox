#!/bin/bash

# Main setup script
# This script orchestrates the entire setup process

set -e

# Source environment variables
# shellcheck disable=SC1091
source "$TEMP_DIR/env_vars"

# Run individual setup scripts
"$TEMP_DIR/.config/devcontainer/ubuntu/scripts/setup-proxy.sh"
"$TEMP_DIR/.config/devcontainer/ubuntu/scripts/install-packages.sh"
"$TEMP_DIR/.config/devcontainer/ubuntu/scripts/install-taskfile.sh"
"$TEMP_DIR/.config/devcontainer/ubuntu/scripts/setup-go.sh"
"$TEMP_DIR/.config/devcontainer/ubuntu/scripts/setup-user.sh" "$USER"

echo "Init process completed successfully."
