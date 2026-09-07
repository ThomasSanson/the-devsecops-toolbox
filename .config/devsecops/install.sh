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
# Pinned versions — update these when upgrading the toolchain.
# The `# renovate:` annotations let Renovate bump these bootstrap pins in
# lockstep with the canonical .config/<tool>/version files (same datasource),
# so install.sh can never drift from the framework. See .config/renovate/.
# ---------------------------------------------------------------------------
# renovate: datasource=github-releases depName=go-task/task extractVersion=^v(?<version>.*)$
TASK_VERSION="3.49.1"
GIT_MIN_VERSION="2.34.0"
PYTHON_VERSION="3.14"
# renovate: datasource=pypi depName=copier
COPIER_VERSION="copier==9.18.2"
# renovate: datasource=github-releases depName=charmbracelet/gum extractVersion=^v(?<version>.*)$
GUM_VERSION="0.17.0"
# renovate: datasource=github-releases depName=charmbracelet/glow extractVersion=^v(?<version>.*)$
GLOW_VERSION="2.1.1"

# Selectable components offered when NOT installing the complete framework.
# This list is designed to grow (plan/code phases, etc.); today it holds a
# single entry. Keep "Agent mode" as the stable match prefix.
AGENT_COMPONENT_LABEL="Agent mode — AI agent guardrails (.agent/, CLAUDE.md, AGENTS.md)"
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

# True when an interactive terminal is reachable (stdin is a TTY, or /dev/tty
# can be opened — e.g. the documented `curl … | bash` path). Used to gate the
# interactive scope selection: non-interactive runs (CI, piped without a tty)
# keep the default behavior and install the complete framework.
has_interactive_tty() {
  if [ -t 0 ]; then
    return 0
  fi
  if [ -r /dev/tty ] && (: </dev/tty) 2>/dev/null; then
    return 0
  fi
  return 1
}

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
# Install the premium interactive UI layer (gum + glow), used to ask which
# parts of the framework to install. Best-effort: when the download is not
# possible (no network, unsupported arch), the scope selection degrades to a
# plain yes/no prompt instead of failing the whole installer.
# ---------------------------------------------------------------------------
install_charm_tool() {
  tool="$1"
  version="$2"

  if command_exists "$tool"; then
    log_ok "${tool} is already installed."
    return 0
  fi

  charm_arch=""
  case "$(uname -m)" in
  x86_64) charm_arch="Linux_x86_64" ;;
  aarch64 | arm64) charm_arch="Linux_arm64" ;;
  armv7l | armhf) charm_arch="Linux_armv6" ;;
  i386 | i686) charm_arch="Linux_i386" ;;
  *)
    log_info "Unsupported architecture for ${tool}: $(uname -m)."
    return 1
    ;;
  esac

  log_action "Installing ${tool} v${version}..."
  install_dir="${HOME}/.local/bin"
  ensure_path "${install_dir}"
  mkdir -p "${install_dir}"

  tmp_dir="$(mktemp -d)"
  download_url="https://github.com/charmbracelet/${tool}/releases/download/v${version}/${tool}_${version}_${charm_arch}.tar.gz"
  if ! curl -fsSL "${download_url}" -o "${tmp_dir}/${tool}.tar.gz"; then
    log_info "Failed to download ${tool} from ${download_url}."
    rm -rf "${tmp_dir}"
    return 1
  fi

  tar -xzf "${tmp_dir}/${tool}.tar.gz" -C "${tmp_dir}"
  if [ -f "${tmp_dir}/${tool}_${version}_${charm_arch}/${tool}" ]; then
    mv "${tmp_dir}/${tool}_${version}_${charm_arch}/${tool}" "${install_dir}/${tool}"
  else
    find "${tmp_dir}" -type f -name "${tool}" -exec mv {} "${install_dir}/${tool}" \;
  fi
  chmod +x "${install_dir}/${tool}"
  rm -rf "${tmp_dir}"

  if command_exists "$tool"; then
    log_ok "${tool} v${version} installed."
    return 0
  fi

  log_info "${tool} installation did not complete."
  return 1
}

install_ui_tools() {
  install_charm_tool gum "$GUM_VERSION" || true
  install_charm_tool glow "$GLOW_VERSION" || true
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
# Installation scope — ask what to install before scaffolding.
#   everything : the complete framework (Copier questionnaire + init)
#   agent      : only the AI agent context (.agent/, CLAUDE.md, AGENTS.md)
#   none       : nothing selected
# Driven by the premium gum/glow UI layer when available, with a plain
# yes/no fallback so the installer still works without it.
# ---------------------------------------------------------------------------
select_install_scope() {
  INSTALL_SCOPE="everything"

  # No interactive terminal (CI, piped without a tty): keep the default and
  # install the complete framework, exactly as before this prompt existed.
  if ! has_interactive_tty; then
    return 0
  fi

  if command_exists gum; then
    select_install_scope_gum
  else
    select_install_scope_plain
  fi
}

select_install_scope_gum() {
  if command_exists glow; then
    scope_card="$(mktemp)"
    {
      echo "# 📦 DevSecOps Toolbox"
      echo ""
      echo "Choose what to install:"
      echo ""
      echo "- **Complete framework** — the full DevSecOps pipeline (CI/CD, security scanning, tasks)"
      echo "- **Pick components** — choose individual parts (today: the AI agent guardrails)"
    } >"$scope_card"
    echo
    glow -s dark -w 76 "$scope_card"
    rm -f "$scope_card"
    echo
  fi

  if gum confirm "Install the complete DevSecOps framework?" \
    --affirmative "Install everything" \
    --negative "Choose components"; then
    INSTALL_SCOPE="everything"
    return 0
  fi

  # Component selection. One component today (the AI agent guardrails); it is
  # presented as a single-select list, so the developer SEES the choice and just
  # presses Enter to take the highlighted item.
  #
  # Single-select (gum's default --limit 1) is deliberate, not a --no-limit
  # multi-select: a multi-select springs a trap on a lone item — it is NOT
  # selected until the user presses Space, so a natural Enter picks NOTHING, gum
  # returns empty, INSTALL_SCOPE stays "none", and the installer exits "Nothing
  # selected" having installed no files. When a second component is added, revisit
  # this as a --no-limit multi-select with a default item already selected.
  selected_components="$(gum choose --no-show-help \
    --header "Select the component to install (↑/↓ to choose, enter to confirm):" \
    "$AGENT_COMPONENT_LABEL")" || selected_components=""

  INSTALL_SCOPE="none"
  case "$selected_components" in
  *"Agent mode"*) INSTALL_SCOPE="agent" ;;
  esac
}

select_install_scope_plain() {
  if prompt_yes_no_default_yes "Install the complete DevSecOps framework? [Y/n]: "; then
    INSTALL_SCOPE="everything"
    return 0
  fi
  if prompt_yes_no_default_yes "Install the AI agent guardrails (.agent/, CLAUDE.md, AGENTS.md)? [Y/n]: "; then
    INSTALL_SCOPE="agent"
    return 0
  fi
  INSTALL_SCOPE="none"
}

# ---------------------------------------------------------------------------
# Agent mode — render ONLY the AI agent context into the project.
# Copier always writes its answers file and the full tree, so we render to a
# scratch directory with defaults and copy out only .agent/, CLAUDE.md and
# AGENTS.md. The result is a working tree carrying nothing but the agent
# context (no Taskfile, no .config, no Copier bookkeeping).
# ---------------------------------------------------------------------------
scaffold_agent_only() {
  echo ""
  echo "📋 Installing agent mode..."
  log_action "Rendering the AI agent context (.agent/, CLAUDE.md, AGENTS.md)..."

  render_dir="$(mktemp -d)"
  render_log="$(mktemp)"
  if [ -n "${TEMPLATE_VCS_REF}" ]; then
    copier_command="uvx --python \"${PYTHON_VERSION}\" --from \"${COPIER_VERSION}\" copier copy \"${TEMPLATE_URL}\" \"${render_dir}\" --trust --skip-tasks --defaults --quiet --vcs-ref \"${TEMPLATE_VCS_REF}\" >\"${render_log}\" 2>&1"
  else
    copier_command="uvx --python \"${PYTHON_VERSION}\" --from \"${COPIER_VERSION}\" copier copy \"${TEMPLATE_URL}\" \"${render_dir}\" --trust --skip-tasks --defaults --quiet >\"${render_log}\" 2>&1"
  fi
  run_with_interactive_input "$copier_command" || true

  agent_installed=0
  for item in .agent AGENTS.md CLAUDE.md; do
    if [ -e "${render_dir}/${item}" ]; then
      cp -a "${render_dir}/${item}" "./${item}"
      agent_installed=1
    fi
  done
  rm -rf "${render_dir}"

  # Normalise permissions to be umask-independent. Copier renders under the
  # container umask and `cp -a` preserves it: CI runners use umask 000, which
  # leaves the copied .agent/ dirs world-writable (0777). That is a security
  # smell AND a visual drift — `tree` colours world-writable dirs green-on-green
  # instead of the plain blue a 0755 dir gets, so the agent-mode tree baseline
  # (captured under a 022 umask) fails on CI. Force 0755 dirs / 0644 files.
  if [ -d .agent ]; then
    find .agent -type d -exec chmod 755 {} + 2>/dev/null || true
    find .agent -type f -exec chmod 644 {} + 2>/dev/null || true
  fi
  chmod 644 AGENTS.md CLAUDE.md 2>/dev/null || true

  if [ "$agent_installed" -ne 1 ] || [ ! -d ".agent" ]; then
    log_error "Agent mode installation failed — the AI agent context was not found in the template."
    sed 's/^/    /' "${render_log}" 2>/dev/null | tail -n 20
    rm -f "${render_log}"
    exit 1
  fi
  rm -f "${render_log}"

  log_ok "Agent mode installed."
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
  install_ui_tools

  echo ""
  select_install_scope

  if [ "${INSTALL_SCOPE}" = "none" ]; then
    echo ""
    log_info "Nothing selected — no files were installed."
    log_info "Re-run the installer to choose what to install."
    echo ""
    return 0
  fi

  if [ "${INSTALL_SCOPE}" = "agent" ]; then
    scaffold_agent_only

    echo ""
    log_ok "Installation complete!"
    log_info "Installed the AI agent context only: .agent/, CLAUDE.md, AGENTS.md."
    log_info "See AGENTS.md to get started."
    echo ""
    return 0
  fi

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
