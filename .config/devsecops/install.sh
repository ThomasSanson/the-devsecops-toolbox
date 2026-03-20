#!/usr/bin/env sh
# DevSecOps Toolbox Installer
# Usage:
#   sh -c "$(curl --location https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/raw/main/install.sh)"
#
# Prerequisites: curl
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
GIT_MIN_VERSION="2.34.0"
PYTHON_VERSION="3.14"
COPIER_VERSION="copier==9.13.1"
DEFAULT_TEMPLATE_URL="https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox"
TEMPLATE_URL="${DEVSECOPS_TEMPLATE_URL:-$DEFAULT_TEMPLATE_URL}"
TEMPLATE_VCS_REF="${DEVSECOPS_TEMPLATE_VCS_REF:-}"

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

resolve_interactive_input() {
  if [ -t 0 ]; then
    printf "%s" "-"
    return 0
  fi

  if [ ! -t 0 ] && [ -r /dev/tty ] && (: </dev/tty) 2>/dev/null; then
    printf "%s" "/dev/tty"
    return 0
  fi

  printf "%s" "-"
}

INTERACTIVE_INPUT="$(resolve_interactive_input)"

normalize_version() {
  version="$1"
  major="${version%%.*}"

  if [ "$major" = "$version" ]; then
    printf "%s.%s.%s\n" "${major:-0}" "0" "0"
    return
  fi

  remainder="${version#*.}"
  minor="${remainder%%.*}"

  if [ "$minor" = "$remainder" ]; then
    printf "%s.%s.%s\n" "${major:-0}" "${minor:-0}" "0"
    return
  fi

  patch="${remainder#*.}"
  patch="${patch%%.*}"
  printf "%s.%s.%s\n" "${major:-0}" "${minor:-0}" "${patch:-0}"
}

version_ge() {
  current="$(normalize_version "$1")"
  required="$(normalize_version "$2")"
  awk -v current="$current" -v required="$required" '
    BEGIN {
      split(current, c, /\./)
      split(required, r, /\./)
      for (i = 1; i <= 3; i++) {
        c[i] += 0
        r[i] += 0
        if (c[i] > r[i]) exit 0
        if (c[i] < r[i]) exit 1
      }
      exit 0
    }
  '
}

prompt_yes_no_default_yes() {
  prompt="$1"
  while true; do
    printf "%s" "$prompt"
    if [ "$INTERACTIVE_INPUT" = "/dev/tty" ]; then
      if ! IFS= read -r answer </dev/tty; then
        answer="y"
      fi
    elif ! IFS= read -r answer; then
      answer="y"
    fi

    case "$answer" in
    "" | y | Y | yes | YES | Yes) return 0 ;;
    n | N | no | NO | No) return 1 ;;
    *) log_info "Please answer y or n." ;;
    esac
  done
}

run_with_interactive_input() {
  command="$1"
  if [ "$INTERACTIVE_INPUT" = "/dev/tty" ]; then
    sh -c "$command" </dev/tty
    return $?
  fi

  sh -c "$command"
}

run_with_privilege() {
  command="$1"
  if [ "$(id -u)" -eq 0 ]; then
    sh -c "$command"
    return $?
  fi
  if command_exists sudo; then
    sudo sh -c "$command"
    return $?
  fi
  return 1
}

install_git() {
  log_action "Installing Git..."

  if command_exists apt-get; then
    log_info "Detected package manager: apt-get"
    run_with_privilege "DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git"
  elif command_exists dnf; then
    log_info "Detected package manager: dnf"
    run_with_privilege "dnf install -y git"
  elif command_exists yum; then
    log_info "Detected package manager: yum"
    run_with_privilege "yum install -y git"
  elif command_exists microdnf; then
    log_info "Detected package manager: microdnf"
    run_with_privilege "microdnf install -y git"
  elif command_exists apk; then
    log_info "Detected package manager: apk"
    run_with_privilege "apk add --no-cache git"
  elif command_exists pacman; then
    log_info "Detected package manager: pacman"
    run_with_privilege "pacman -Sy --noconfirm git"
  elif command_exists zypper; then
    log_info "Detected package manager: zypper"
    run_with_privilege "zypper --non-interactive refresh && zypper --non-interactive install git"
  elif command_exists brew; then
    log_info "Detected package manager: brew"
    brew install git
  else
    log_error "No supported package manager found for automatic Git installation."
    return 1
  fi
}

ensure_git() {
  required_version="$(normalize_version "$GIT_MIN_VERSION")"
  current_version=""

  if command_exists git; then
    current_version="$(git --version 2>/dev/null | awk '{print $3}' | sed -E 's/[^0-9.].*$//')"
    current_version="$(normalize_version "$current_version")"
    if version_ge "$current_version" "$required_version"; then
      log_ok "git v${current_version} is installed."
      return 0
    fi
    log_info "git v${current_version} found, but v${GIT_MIN_VERSION}+ is required."
  else
    log_info "Git is required to scaffold this project with Copier."
    log_info "Minimum required version: v${GIT_MIN_VERSION}."
  fi

  if ! prompt_yes_no_default_yes "Install Git now? [Y/n]: "; then
    log_error "Git is required to continue. Please install git v${GIT_MIN_VERSION}+ and rerun."
    exit 1
  fi

  if ! install_git; then
    log_error "Automatic Git installation failed."
    log_info "Install git v${GIT_MIN_VERSION}+ manually, then rerun this installer."
    exit 1
  fi

  if ! command_exists git; then
    log_error "git installation failed."
    exit 1
  fi

  current_version="$(git --version 2>/dev/null | awk '{print $3}' | sed -E 's/[^0-9.].*$//')"
  current_version="$(normalize_version "$current_version")"
  if ! version_ge "$current_version" "$required_version"; then
    log_error "Installed git version (${current_version}) is below the required v${GIT_MIN_VERSION}+."
    exit 1
  fi

  log_ok "git v${current_version} is installed."
}

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
preflight() {
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
  copier_command=""

  if [ -f "Taskfile.yml" ]; then
    log_ok "Taskfile.yml already exists — skipping Copier scaffolding."
    return 0
  fi

  log_action "Scaffolding project with Copier..."
  log_info "Template source: ${TEMPLATE_URL}"
  if [ -n "${TEMPLATE_VCS_REF}" ]; then
    log_info "Template ref: ${TEMPLATE_VCS_REF}"
    copier_command="uvx --python \"${PYTHON_VERSION}\" --from \"${COPIER_VERSION}\" copier copy \"${TEMPLATE_URL}\" . --trust --skip-tasks --vcs-ref \"${TEMPLATE_VCS_REF}\" 2>&1"
  else
    copier_command="uvx --python \"${PYTHON_VERSION}\" --from \"${COPIER_VERSION}\" copier copy \"${TEMPLATE_URL}\" . --trust --skip-tasks 2>&1"
  fi

  run_with_interactive_input "$copier_command"

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
  if task devsecops:init; then
    return 0
  fi

  log_info "task devsecops:init failed. Attempting to install missing prerequisites..."
  if task devsecops:init:prerequisites; then
    log_info "Prerequisites task completed."
  else
    log_info "Prerequisites task returned non-zero."
    log_info "Continuing with retry because some template versions run extra setup in this task."
  fi

  log_info "Retrying project initialization..."
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
  ensure_git
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
