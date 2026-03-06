#!/bin/bash

set -e

install_uv() {
  echo "Installing UV..."

  pipx ensurepath
  pipx install uv

  uv python install "$(cat .config/python/.python-version)"

  echo "UV installation completed."
}

install_uv
