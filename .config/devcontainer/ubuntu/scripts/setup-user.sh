#!/bin/bash

# Setup Non-Root User

set -e

# shellcheck disable=SC1091
source "$TEMP_DIR/env_vars"

setup_user() {
  local USER="$1"

  echo "Setting up non-root user: $USER"

  # Verify whether the user already exists
  if id "$USER" &>/dev/null; then
    echo "User $USER already exists, skipping user creation"
  else
    echo "Creating user $USER"
    useradd -m "$USER"
  fi

  # Configure sudo access - avoid overwriting existing configuration
  if [ ! -f "/etc/sudoers.d/$USER" ]; then
    echo "Creating sudo configuration for $USER"
    echo "$USER ALL=(root) NOPASSWD:ALL" >"/etc/sudoers.d/$USER"
    chmod 0440 "/etc/sudoers.d/$USER"
  else
    echo "Sudo configuration for $USER already exists, skipping"
  fi

  echo "Configuring shell for $USER"

  # Create home directory if it does not exist
  if [ ! -d "/home/$USER" ]; then
    mkdir -p "/home/$USER"
    chown "$USER:$USER" "/home/$USER"
  fi

  # Add shell configurations only if they do not already exist
  if ! grep -q "source ~/.bashrc" "/home/$USER/.bash_profile" 2>/dev/null; then
    echo 'source ~/.bashrc' >>"/home/$USER/.bash_profile"
  fi

  if ! grep -q "alias ll=" "/home/$USER/.bashrc" 2>/dev/null; then
    echo "alias ll='ls -lisa --color'" >>"/home/$USER/.bashrc"
  fi

  # Configure Taskfile completion
  if [ ! -f "/home/$USER/task.bash" ]; then
    wget --progress=dot:giga https://raw.githubusercontent.com/go-task/task/main/completion/bash/task.bash -O "/home/$USER/task.bash"
    chmod +x "/home/$USER/task.bash"
    chown "$USER:$USER" "/home/$USER/task.bash"
  fi

  if ! grep -q "source ~/task.bash" "/home/$USER/.bashrc" 2>/dev/null; then
    echo 'source ~/task.bash' >>"/home/$USER/.bashrc"
  fi

  # Ensure all configuration files belong to the user
  chown "$USER:$USER" "/home/$USER/.bash_profile" "/home/$USER/.bashrc" 2>/dev/null || true

  echo "Non-root user setup completed."
}

setup_user "$1"
