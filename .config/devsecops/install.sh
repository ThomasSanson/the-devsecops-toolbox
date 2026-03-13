#!/usr/bin/env sh
# DevSecOps Toolbox Installer
# Usage:
#   sh -c "$(curl --location https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/raw/main/install.sh)"
#
# Prerequisites: curl, git (inside an initialized git repository)
#
# This script installs the minimum toolchain required to scaffold and
# initialize a DevSecOps project:
#   1. task   — command runner (pinned version)
#   2. uv     — Python package manager (handles Python + Copier)
#   3. copier — project template engine (run via uvx)
#
# After scaffolding, it delegates to `task devsecops:init` for full
# project configuration (tool verification, GitLab setup, etc.).

set -eu

# ---------------------------------------------------------------------------
# Pinned versions — update these when upgrading the toolchain
# ---------------------------------------------------------------------------
TASK_VERSION="3.49.1"
PYTHON_VERSION="3.14"
COPIER_VERSION="copier==9.13.1"
TEMPLATE_URL="https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log_info() { printf "  ℹ️  %s\n" "$*"; }
log_ok() { printf "  ✅ %s\n" "$*"; }
log_error() { printf "  ❌ %s\n" "$*"; }
log_action() { printf "  🔄 %s\n" "$*"; }

command_exists() { command -v "$1" >/dev/null 2>&1; }

ensure_path() {
  case ":${PATH}:" in
  *":$1:"*) ;;
  *) export PATH="$1:${PATH}" ;;
  esac
}

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
preflight() {
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    log_error "Not inside a git repository."
    log_info "Initialize a repository first:"
    log_info "  mkdir my-project && cd my-project && git init"
    log_info "Then rerun this installer."
    exit 1
  fi

  if ! command_exists curl; then
    log_error "curl is required but not installed."
    log_info "Install curl with your package manager, then rerun this installer."
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Install task
# ---------------------------------------------------------------------------
install_task() {
  TASK_INSTALL_DIR="${HOME}/.local/bin"
  ensure_path "${TASK_INSTALL_DIR}"

  if command_exists task; then
    current="$(task --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
    if [ "$current" = "$TASK_VERSION" ]; then
      log_ok "task v${TASK_VERSION} is already installed."
      return 0
    fi
    log_info "task v${current} found but v${TASK_VERSION} is required."
  fi

  log_action "Installing task v${TASK_VERSION}..."
  mkdir -p "${TASK_INSTALL_DIR}"
  sh -c "$(curl --silent --location https://taskfile.dev/install.sh)" \
    -- -d -b "${TASK_INSTALL_DIR}" "v${TASK_VERSION}" 2>&1

  if command_exists task; then
    log_ok "task v${TASK_VERSION} installed."
  else
    log_error "task installation failed."
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Install uv
# ---------------------------------------------------------------------------
install_uv() {
  ensure_path "${HOME}/.local/bin"

  if command_exists uv; then
    log_ok "uv is already installed ($(uv --version 2>/dev/null))."
    return 0
  fi

  log_action "Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh 2>&1

  if command_exists uv; then
    log_ok "uv installed ($(uv --version 2>/dev/null))."
  else
    log_error "uv installation failed."
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Scaffold project with Copier (only when Taskfile.yml is absent)
# ---------------------------------------------------------------------------
scaffold_project() {
  if [ -f "Taskfile.yml" ]; then
    log_ok "Taskfile.yml already exists — skipping Copier scaffolding."
    return 0
  fi

  log_action "Scaffolding project with Copier..."
  uvx --python "${PYTHON_VERSION}" --from "${COPIER_VERSION}" \
    copier copy "${TEMPLATE_URL}" . --trust 2>&1

  if [ -f "Taskfile.yml" ]; then
    log_ok "Project scaffolded successfully."
  else
    log_error "Copier scaffolding failed — Taskfile.yml not found."
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Run project initialization
# ---------------------------------------------------------------------------
run_init() {
  log_action "Running project initialization..."
  task devsecops:init
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  echo ""
  echo "🚀 DevSecOps Toolbox Installer"
  echo ""

  preflight

  echo ""
  echo "📦 Installing toolchain..."
  install_task
  install_uv

  echo ""
  echo "📋 Setting up project..."
  scaffold_project

  echo ""
  echo "⚙️  Initializing project..."
  run_init

  echo ""
  log_ok "Installation complete!"
  log_info "Run 'task' to see available commands."

  # Warn if ~/.local/bin is missing from the persistent PATH
  case ":${PATH}:" in
  *":${HOME}/.local/bin:"*) ;;
  *)
    echo ""
    echo "  ⚠️  WARNING: ${HOME}/.local/bin is not in your shell PATH."
    echo "  Installed tools (task, uv) may not be found in new terminals."
    echo ""
    echo "  Add this line to your ~/.bashrc or ~/.zshrc:"
    echo ""
    echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo ""
    ;;
  esac
  echo ""
}

main "$@"
