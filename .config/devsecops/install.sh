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
COPIER_VERSION="copier==9.17.2"
# renovate: datasource=github-releases depName=charmbracelet/gum extractVersion=^v(?<version>.*)$
GUM_VERSION="0.17.0"
# renovate: datasource=github-releases depName=charmbracelet/glow extractVersion=^v(?<version>.*)$
GLOW_VERSION="2.1.1"

# Selectable components offered when NOT installing the complete framework.
# This list is designed to grow (plan/code phases, etc.). Keep "Agent mode" and
# "Source publication" as the stable match prefixes.
# NO COMMA in a label: gum reads --selected as a COMMA-SEPARATED list, so a
# label containing one is split into fragments that match no option, nothing
# starts ticked, and a plain Enter then installs nothing at all.
AGENT_COMPONENT_LABEL="Agent mode — AI agent guardrails: .agent/ AGENTS.md CLAUDE.md"
PUBLICATION_COMPONENT_LABEL="Source publication — publish this repository's source to a public one"
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
  INSTALL_AGENT=0
  INSTALL_PUBLICATION=0

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
      echo "- **Pick components** — choose individual parts:"
      echo "  - the AI agent guardrails"
      echo "  - source publication, to publish a private project's source to a public one"
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

  # Component selection, as a checklist: several components can be installed in
  # one go, so this is a --no-limit multi-select.
  #
  # --selected is not decoration, it is the trap-avoidance: in a multi-select an
  # item is NOT picked until the user presses Space, so a natural Enter on an
  # untouched list returns EMPTY and the installer would exit "Nothing selected"
  # having installed no files. Starting with the first component ticked means
  # Enter always installs something, and Space still unticks it.
  selected_components="$(gum choose --no-show-help --no-limit \
    --selected "$AGENT_COMPONENT_LABEL" \
    --header "Select what to install (↑/↓ to move, space to tick, enter to confirm):" \
    "$AGENT_COMPONENT_LABEL" \
    "$PUBLICATION_COMPONENT_LABEL")" || selected_components=""

  read_component_selection "$selected_components"
}

# Turn gum's answer (one label per line) into the install flags. Matching on the
# stable label prefix keeps the wording free to change.
read_component_selection() {
  INSTALL_AGENT=0
  INSTALL_PUBLICATION=0
  case "$1" in
  *"Agent mode"*) INSTALL_AGENT=1 ;;
  esac
  case "$1" in
  *"Source publication"*) INSTALL_PUBLICATION=1 ;;
  esac

  if [ "$INSTALL_AGENT" -eq 0 ] && [ "$INSTALL_PUBLICATION" -eq 0 ]; then
    INSTALL_SCOPE="none"
  else
    INSTALL_SCOPE="components"
  fi
}

select_install_scope_plain() {
  if prompt_yes_no_default_yes "Install the complete DevSecOps framework? [Y/n]: "; then
    INSTALL_SCOPE="everything"
    return 0
  fi

  INSTALL_AGENT=0
  INSTALL_PUBLICATION=0
  if prompt_yes_no_default_yes "Install the AI agent guardrails (.agent/, CLAUDE.md, AGENTS.md)? [Y/n]: "; then
    INSTALL_AGENT=1
  fi
  if prompt_yes_no_default_yes "Install source publication (.config/publication/)? [Y/n]: "; then
    INSTALL_PUBLICATION=1
  fi

  INSTALL_SCOPE="components"
  if [ "$INSTALL_AGENT" -eq 0 ] && [ "$INSTALL_PUBLICATION" -eq 0 ]; then
    INSTALL_SCOPE="none"
  fi
}

# ---------------------------------------------------------------------------
# Component installs — render the template into a SCRATCH directory and copy out
# only the parts the developer picked. Copier always writes its answers file and
# the full tree, so the scratch render is what makes a partial install possible:
# the project ends up carrying the component and nothing else (no Taskfile, no
# other .config, no Copier bookkeeping).
# ---------------------------------------------------------------------------
render_template_to_scratch() {
  render_dir="$1"
  extra_data="$2"
  render_log="$(mktemp)"
  if [ -n "${TEMPLATE_VCS_REF}" ]; then
    copier_command="uvx --python \"${PYTHON_VERSION}\" --from \"${COPIER_VERSION}\" copier copy \"${TEMPLATE_URL}\" \"${render_dir}\" --trust --skip-tasks --defaults --quiet ${extra_data} --vcs-ref \"${TEMPLATE_VCS_REF}\" >\"${render_log}\" 2>&1"
  else
    copier_command="uvx --python \"${PYTHON_VERSION}\" --from \"${COPIER_VERSION}\" copier copy \"${TEMPLATE_URL}\" \"${render_dir}\" --trust --skip-tasks --defaults --quiet ${extra_data} >\"${render_log}\" 2>&1"
  fi
  run_with_interactive_input "$copier_command" || true
}

# Normalise permissions to be umask-independent. Copier renders under the
# container umask and `cp -a` preserves it: CI runners use umask 000, which
# leaves the copied dirs world-writable (0777). That is a security smell AND a
# visual drift — `tree` colours world-writable dirs green-on-green instead of the
# plain blue a 0755 dir gets, so a tree baseline captured under a 022 umask fails
# on CI. Force 0755 dirs / 0644 files.
normalise_permissions() {
  for target in "$@"; do
    if [ -d "$target" ]; then
      find "$target" -type d -exec chmod 755 {} + 2>/dev/null || true
      find "$target" -type f -exec chmod 644 {} + 2>/dev/null || true
    elif [ -f "$target" ]; then
      chmod 644 "$target" 2>/dev/null || true
    fi
  done
}

# Agent mode — render ONLY the AI agent context into the project.
scaffold_agent_only() {
  echo ""
  echo "📋 Installing agent mode..."
  log_action "Rendering the AI agent context (.agent/, CLAUDE.md, AGENTS.md)..."

  render_dir="$(mktemp -d)"
  render_template_to_scratch "${render_dir}" ""

  agent_installed=0
  for item in .agent AGENTS.md CLAUDE.md; do
    if [ -e "${render_dir}/${item}" ]; then
      cp -a "${render_dir}/${item}" "./${item}"
      agent_installed=1
    fi
  done
  rm -rf "${render_dir}"
  normalise_permissions .agent AGENTS.md CLAUDE.md

  if [ "$agent_installed" -ne 1 ] || [ ! -d ".agent" ]; then
    log_error "Agent mode installation failed — the AI agent context was not found in the template."
    sed 's/^/    /' "${render_log}" 2>/dev/null | tail -n 20
    rm -f "${render_log}"
    exit 1
  fi
  rm -f "${render_log}"

  log_ok "Agent mode installed."
}

# Source publication — the component, plus the spine that keeps it up to date.
#
# The component alone would be a dead copy: no version, no way to learn that a
# new release exists, no way to apply it. So the install keeps the framework's
# OWN update machinery instead of inventing a second one: the copier answers
# file (which records the template and the version), the handful of files
# `task copier:update` needs to run, and the Renovate config that watches that
# answers file. Renovate then maintains this project exactly as it maintains a
# full one, and copier's three-way merge is what protects the four files the
# project owns (allowlist, denylist, owners, manifest) when a release lands.
#
# Measured: 22 files and ~120 KB, against 199 files and 1.7 MB for a full
# install. What it leaves out is every tool — no linter, no container runtime,
# no forge CLI.
#
# The render answers no to the project workspace and to docker compose: without
# that, copier's `_skip_if_exists` entries (VERSION, project/docker-compose.yml,
# .config/cspell/config.project.json) are recreated on the first update, and a
# project that installed one component would watch files it never asked for
# appear out of nowhere.
# .env.dist is where the publication settings live (enabled, target, branch),
# and the root Taskfile loads it. Nothing else at the root has a reason to be in
# a project that took one component.
PUBLICATION_SPINE_DIRS=".config/publication"

copy_spine_file() {
  src="$1"
  dst="$2"
  [ -e "${src}" ] || return 0
  mkdir -p "$(dirname "${dst}")"
  cp -a "${src}" "${dst}"
}

# A project can already have a root Taskfile or a .env.dist of its own, and
# overwriting either would destroy work that has nothing to do with this
# component. Those two are copied only when they are absent; when they are
# there, the installer says what to add instead of deciding for you.
PUBLICATION_MANUAL_STEPS=""

copy_or_report() {
  src="$1"
  dst="$2"
  advice="$3"
  [ -e "${src}" ] || return 0
  if [ -e "${dst}" ]; then
    PUBLICATION_MANUAL_STEPS="${PUBLICATION_MANUAL_STEPS}${advice}
"
    return 0
  fi
  mkdir -p "$(dirname "${dst}")"
  cp -a "${src}" "${dst}"
}

scaffold_publication_only() {
  echo ""
  echo "📋 Installing source publication..."
  log_action "Rendering the publication component and its update spine..."

  render_dir="$(mktemp -d)"
  render_template_to_scratch "${render_dir}" \
    "--data install_scope=publication --data source_publication=true --data project_enabled=false --data use_docker_compose=false --data ansible_enabled=false"

  if [ ! -d "${render_dir}/.config/publication" ]; then
    log_error "Source publication installation failed — the component was not found in the template."
    sed 's/^/    /' "${render_log}" 2>/dev/null | tail -n 20
    rm -f "${render_log}"
    rm -rf "${render_dir}"
    exit 1
  fi

  PUBLICATION_MANUAL_STEPS=""
  copy_or_report "${render_dir}/Taskfile.yml" "./Taskfile.yml" \
    "Taskfile.yml is yours already — add these includes to it:
  publication:
    taskfile: .config/publication/Taskfile.yml
    optional: true
  copier:
    taskfile: .config/copier/Taskfile.yml
    optional: true"
  copy_or_report "${render_dir}/.env.dist" "./.env.dist" \
    ".env.dist is yours already — add these settings to it:
  TASK_PUBLICATION_ENABLED=false
  TASK_PUBLICATION_TARGET_URL=
  TASK_PUBLICATION_TARGET_BRANCH=main
  TASK_PUBLICATION_SOURCE_REF=
  TASK_PUBLICATION_ON=release
  TASK_PUBLICATION_SCAN=required"
  # A pipeline is the project's own, and clobbering it would be the rudest thing
  # this installer could do. The component ships its jobs in a file of its own;
  # the root pipeline only ever gains one include line, and only when there is
  # no root pipeline to break.
  if [ -e ./.gitlab-ci.yml ]; then
    PUBLICATION_MANUAL_STEPS="${PUBLICATION_MANUAL_STEPS}.gitlab-ci.yml is yours already — add this include to it:
  include:
    - local: .config/publication/gitlab-ci.yml
"
  else
    cat >./.gitlab-ci.yml <<'CI_EOF'
---
# Source publication: the release job that publishes, and the feedback job that
# lets Renovate bring the next toolbox release in.
include:
  - local: .config/publication/gitlab-ci.yml
CI_EOF
  fi
  # The update machinery, and only it: the answers file that records the
  # template and the release, copier, and the Renovate config that opens the
  # framework-evolution merge request. The nine phase orchestrators stay behind —
  # a project that publishes has no build, deploy or monitor phase to run.
  copy_spine_file "${render_dir}/.config/devsecops/.copier-answers.yml" ".config/devsecops/.copier-answers.yml"
  copy_spine_file "${render_dir}/.config/copier/Taskfile.yml" ".config/copier/Taskfile.yml"
  copy_spine_file "${render_dir}/.config/copier/renovate-update.sh" ".config/copier/renovate-update.sh"
  copy_spine_file "${render_dir}/.config/copier/requirements.txt" ".config/copier/requirements.txt"
  copy_spine_file "${render_dir}/.config/python/.python-version" ".config/python/.python-version"
  # The task runner's own installer, pinned. Everything here runs through
  # `task`, CI included, and a pipeline job whose image was chosen for its
  # scanner installs the runner from this file rather than from the internet at
  # large.
  copy_spine_file "${render_dir}/.config/task/install.sh" ".config/task/install.sh"
  copy_spine_file "${render_dir}/.config/task/version" ".config/task/version"
  copy_spine_file "${render_dir}/.config/renovate/config.json" ".config/renovate/config.json"
  # The feedback phase and Renovate's own taskfile: `task feedback` is what runs
  # Renovate, and Renovate is what opens the merge request carrying the next
  # toolbox release. The other eight phase orchestrators stay behind — a project
  # that publishes has no build, deploy or monitor phase to run.
  copy_spine_file "${render_dir}/.config/devsecops/Taskfile.feedback.yml" ".config/devsecops/Taskfile.feedback.yml"
  copy_spine_file "${render_dir}/.config/renovate/Taskfile.yml" ".config/renovate/Taskfile.yml"

  # `cp -a src dst` copies src INSIDE dst when dst already exists, which on a
  # second install would bury the new component in .config/publication/publication.
  # Copy the CONTENTS, and never over a file the project owns.
  for item in ${PUBLICATION_SPINE_DIRS}; do
    mkdir -p "./${item}"
    for file in "${render_dir}/${item}"/*; do
      [ -e "${file}" ] || continue
      target="./${item}/$(basename "${file}")"
      case "$(basename "${file}")" in
      allowlist | denylist | owners | manifest)
        # The project's own decisions: never overwritten by a re-install. A
        # toolbox release reaches them through `task copier:update`, which
        # merges instead of replacing.
        [ -e "${target}" ] && continue
        ;;
      esac
      cp -a "${file}" "${target}"
    done
  done

  rm -rf "${render_dir}"
  rm -f "${render_log}"
  normalise_permissions .config Taskfile.yml .env.dist .gitlab-ci.yml
  chmod 755 .config .config/publication 2>/dev/null || true
  chmod 755 .config/publication/publish.sh 2>/dev/null || true
  chmod 755 .config/copier/renovate-update.sh 2>/dev/null || true
  chmod 755 .config/task/install.sh 2>/dev/null || true

  log_ok "Source publication installed, with the spine that keeps it up to date."
  if [ -n "${PUBLICATION_MANUAL_STEPS}" ]; then
    echo ""
    log_info "Two files were left exactly as you had them. To wire the component in:"
    printf '%s' "${PUBLICATION_MANUAL_STEPS}" | while IFS= read -r line; do
      [ -n "${line}" ] && printf '     %s\n' "${line}"
    done
    echo ""
  fi
  log_info "Next: name the people who approve in .config/publication/owners,"
  log_info "say what may leave in .config/publication/allowlist and denylist,"
  log_info "then run: task publication:check"
  echo ""

  # Where the source goes, and the tokens to get it there. Asked here because
  # this is the moment somebody is sitting in front of the terminal; the same
  # questions are `task publication:init` on any later day.
  if prompt_yes_no_default_yes "Say where the source goes and store the tokens now? [Y/n]: "; then
    # Through the task runner, like every other command this framework offers.
    # A project that already had its own root Taskfile keeps it, and there the
    # include is a line it has yet to add, so the script answers directly.
    if [ -f ./Taskfile.yml ] && grep -q 'publication/Taskfile.yml' ./Taskfile.yml 2>/dev/null; then
      task publication:init || log_info "Run \`task publication:init\` when you are ready."
    else
      sh .config/publication/publish.sh init || log_info "Run \`task publication:init\` when you are ready."
    fi
  else
    log_info "When you are: task publication:init"
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
# Nothing lands on a machine without saying what it is and what it is for. The
# first questions are asked in plain shell, because the tool that makes them
# pretty is itself one of the things being asked about; once it is there, it asks
# the rest. Without a terminal (CI, curl piped into sh with no tty) nothing is
# asked and everything is installed, exactly as before this existed.
confirm_install() {
  _tool="$1"
  _command="$2"
  _why="$3"
  # Already there: nothing is about to land, so there is nothing to ask.
  command_exists "${_command}" && return 0
  has_interactive_tty || return 0
  if command_exists gum; then
    gum confirm --default=yes "Install ${_tool}? ${_why}" && return 0
    return 1
  fi
  prompt_yes_no_default_yes "Install ${_tool}? ${_why} [Y/n]: "
}

install_toolchain() {
  echo ""
  echo "📦 Installing toolchain..."
  ensure_git

  if confirm_install "task" "task" "the task runner every command in this framework goes through"; then
    install_task
  else
    log_error "task is required: every command this framework installs runs through it."
    exit 1
  fi

  if confirm_install "uv" "uv" "it installs copier, which renders the framework and applies its updates"; then
    install_uv
  else
    log_error "uv is required: copier renders the framework and brings its updates in."
    exit 1
  fi

  # The only optional ones. Without them the installer asks its questions in
  # plain shell, which is exactly what a machine that refuses them gets.
  if confirm_install "gum and glow" "gum" "they make the questions below readable; plain prompts are used without them"; then
    install_ui_tools
  fi
}

main() {
  echo ""
  echo "🚀 DevSecOps Toolbox Installer"
  echo ""

  preflight

  install_toolchain

  echo ""
  select_install_scope

  if [ "${INSTALL_SCOPE}" = "none" ]; then
    echo ""
    log_info "Nothing selected — no files were installed."
    log_info "Re-run the installer to choose what to install."
    echo ""
    return 0
  fi

  if [ "${INSTALL_SCOPE}" = "components" ]; then
    [ "${INSTALL_AGENT:-0}" -eq 1 ] && scaffold_agent_only
    [ "${INSTALL_PUBLICATION:-0}" -eq 1 ] && scaffold_publication_only

    echo ""
    log_ok "Installation complete!"
    if [ "${INSTALL_AGENT:-0}" -eq 1 ]; then
      log_info "Installed the AI agent context: .agent/, CLAUDE.md, AGENTS.md."
      log_info "See AGENTS.md to get started."
    fi
    if [ "${INSTALL_PUBLICATION:-0}" -eq 1 ]; then
      log_info "Installed source publication: .config/publication/."
      log_info "See .config/publication/README.md to get started."
    fi
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
