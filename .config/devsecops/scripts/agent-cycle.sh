#!/usr/bin/env bash
#
# ============================================================================
# The test-first cycle, driven by the Taskfile instead of anyone's memory
# ============================================================================
#
# DESCRIPTION:
#   The cycle is always the same: write the test, watch it fail, write the code,
#   clean up. Until now the whole sequence lived in prose, addressed to whoever
#   was driving it — a developer in a hurry, or an AI assistant that wants above
#   all to conclude. Prose cannot refuse anything.
#
#   Here each phase is a task, and the phase that was really reached is written
#   on disk. A phase refuses to start when the recorded phase is not the one
#   before it, so the sequence cannot be skipped and nothing has to be
#   remembered. Every phase ends on a gate that answers with an exit code — the
#   one kind of verdict nobody can argue with:
#
#     red           the executor writes the test; the change touches test files
#                   ONLY, the failure is real (check-red-is-real) and nothing is
#                   switched off (check-no-cheat)
#     review:red    a written verdict, ACCEPT or REJECT, kept on disk
#     green         the executor writes the code; the tests now pass
#     review:green  a written verdict on over-engineering
#     refactor      the tests still pass
#
#   The one rule the machinery cannot enforce is the one above it: whoever
#   drives the loop never judges what an exit code can judge.
#
#   The executor is a command, not a product: TASK_AGENT_EXEC_CMD reads the
#   prompt on standard input and edits the working tree. A run that leaves
#   `git diff` empty is a failure, not a success. Known tools are declared one
#   file at a time under .config/devsecops/agents.d/ — see the README there.
#   The framework holds no model name and no vendor of its own.
#
# USAGE:
#   task devsecops:code:agent:doctor
#   task devsecops:code:agent:red -- @my-tag
#   task devsecops:code:agent:review:red
#   task devsecops:code:agent:green -- @my-tag
#   ...
#
# ENVIRONMENT VARIABLES:
#   TASK_AGENT_EXEC_CMD    the command that reads a prompt on stdin and edits
#                          the working tree ({{MODEL}} is replaced by the model)
#   TASK_AGENT_MODEL       the model to pass to it
#   TASK_AGENT_TEST_CMD    how this project runs its tests (default: task test)
#   TASK_AGENT_STATE_DIR   where the phase is recorded (default: tmp/agent)
#   TASK_AGENT_DROP_IN_DIR where the tool drop-ins live
#
# EXIT CODES:
#   0  the phase ran and its gate accepted the result
#   1  out of order, no executor, the executor changed nothing, or a gate refused
#
# ============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m'

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${TASK_AGENT_STATE_DIR:-tmp/agent}"
PHASE_FILE="${STATE_DIR}/phase"
DROP_IN_DIR="${TASK_AGENT_DROP_IN_DIR:-.config/devsecops/agents.d}"
TEST_CMD="${TASK_AGENT_TEST_CMD:-task test}"

# The sequence, and nothing else. `red` opens it: the issue and the branch are a
# human's business, and stay one.
ORDER=(red review:red green review:green refactor)

predecessor() {
  local wanted="$1" previous=''
  for phase in "${ORDER[@]}"; do
    [ "${phase}" = "${wanted}" ] && { printf '%s' "${previous}"; return 0; }
    previous="${phase}"
  done
  printf ''
}

successor() {
  local after="$1" take=0
  for phase in "${ORDER[@]}"; do
    [ "${take}" -eq 1 ] && { printf '%s' "${phase}"; return 0; }
    [ "${phase}" = "${after}" ] && take=1
  done
  printf ''
}

recorded_phase() {
  [ -f "${PHASE_FILE}" ] && cat "${PHASE_FILE}" || printf ''
}

record_phase() {
  mkdir -p "${STATE_DIR}"
  printf '%s' "$1" >"${PHASE_FILE}"
}

# A phase runs only after the one before it. The refusal names what was recorded
# and what it is waiting for, so the way forward is never a guess.
require_phase() {
  local wanted="$1" needed current next
  needed="$(predecessor "${wanted}")"
  current="$(recorded_phase)"
  [ "${current}" = "${needed}" ] && return 0
  next="${ORDER[0]}"
  [ -n "${current}" ] && next="$(successor "${current}")"
  echo -e "${RED}❌ The ${wanted} phase cannot start yet.${NC}"
  echo "   recorded phase : ${current:-(none: the cycle has not started)}"
  echo "   expected phase : ${needed:-(none: this phase opens the cycle)}"
  echo "   next step      : task devsecops:code:agent:${next}"
  return 1
}

# --------------------------------------------------------------------------
# The executor — a command, chosen rather than configured into the framework
# --------------------------------------------------------------------------

# Each drop-in declares AGENT_EXEC_CMD (its first word is the binary to look
# for) and, optionally, AGENT_MODELS_CMD (how that tool lists its own models).
drop_ins() {
  [ -d "${DROP_IN_DIR}" ] || return 0
  find "${DROP_IN_DIR}" -maxdepth 1 -name '*.sh' | sort
}

# shellcheck disable=SC2034  # AGENT_* are consumed by the caller after sourcing
load_drop_in() {
  AGENT_EXEC_CMD=''
  AGENT_MODELS_CMD=''
  # shellcheck source=/dev/null
  source "$1"
}

doctor() {
  echo -e "${BLUE}🔎 AI tools this machine holds${NC}"
  local any=0
  while IFS= read -r drop_in; do
    [ -n "${drop_in}" ] || continue
    any=1
    load_drop_in "${drop_in}"
    local binary="${AGENT_EXEC_CMD%% *}"
    if ! command -v "${binary}" >/dev/null 2>&1; then
      echo -e "   ${YELLOW}✖${NC} $(basename "${drop_in}" .sh)  ${binary}  not on this machine"
      continue
    fi
    echo -e "   ${GREEN}✔${NC} $(basename "${drop_in}" .sh)  ${binary}  found"
    # The models are ASKED to the tool, never held here: a name written into the
    # framework would be stale within months.
    if [ -n "${AGENT_MODELS_CMD}" ]; then
      echo "       models it reports (${AGENT_MODELS_CMD}):"
      eval "${AGENT_MODELS_CMD}" 2>/dev/null | sed 's/^/         /' || echo "         (the tool reported none)"
    else
      echo "       models: this tool reports none"
    fi
  done <<<"$(drop_ins)"
  if [ "${any}" -eq 0 ]; then
    echo "   (no drop-in yet — see ${DROP_IN_DIR}/README.md to declare one)"
  fi
  local chosen
  if chosen="$(resolve_executor)"; then
    echo "   the phases would run: ${chosen}"
  else
    echo "   no executor: set TASK_AGENT_EXEC_CMD, or add a drop-in whose tool is on this machine"
  fi
}

# The first drop-in whose binary is really here. A machine with none is told so,
# rather than left to fail later on a command that does not exist.
resolve_executor() {
  if [ -n "${TASK_AGENT_EXEC_CMD:-}" ]; then
    printf '%s' "${TASK_AGENT_EXEC_CMD}"
    return 0
  fi
  while IFS= read -r drop_in; do
    [ -n "${drop_in}" ] || continue
    load_drop_in "${drop_in}"
    command -v "${AGENT_EXEC_CMD%% *}" >/dev/null 2>&1 && { printf '%s' "${AGENT_EXEC_CMD}"; return 0; }
  done <<<"$(drop_ins)"
  return 1
}

# --------------------------------------------------------------------------
# The prompt — the versioned rules themselves, never a copy of them
# --------------------------------------------------------------------------

# The reference story the integrity rule names, whatever it names today.
reference_story() {
  grep -oE 'project/tests/e2e/features/[^ `)]+\.feature' .agent/rules/tests-integrity.md 2>/dev/null | head -1
}

prompt_for() {
  local phase="$1" tag="${2:-}"
  echo "You are driving the ${phase} phase of the test-first cycle in this repository."
  [ -n "${tag}" ] && echo "The scenario under work is tagged ${tag}."
  echo "Edit the working tree. Do not commit, do not push: the task does that when the gates pass."
  echo
  case "${phase}" in
  red)
    echo "Write the failing test, and nothing else. Touch test files only."
    cat_if .agent/workflows/tdd-step1-red.md
    cat_if .agent/rules/tests-integrity.md
    cat_if "$(reference_story)"
    ;;
  green)
    echo "Write the smallest code that makes that test pass. Do not touch the test."
    cat_if .agent/workflows/tdd-step2-green.md
    ;;
  refactor)
    echo "Improve the code without changing what it does. Do not touch the test."
    cat_if .agent/workflows/tdd-step3-refactor.md
    ;;
  review:red)
    cat <<'GRID'
Be the devil's advocate on the test that was just written, and answer each point:
  - does a stranger reading the .feature alone understand what is tested?
  - does every sentence map to a storyboard card?
  - is the vocabulary the business's, or the implementation's?
  - did the run fail on the assertion, or on its way to it?
  - would the test still pass if the rule it claims to protect were broken?
End with a line reading exactly `VERDICT: ACCEPT` or `VERDICT: REJECT`.
GRID
    ;;
  review:green)
    cat <<'GRID'
Hunt over-engineering in the code that was just written, and name it:
  - an abstraction with a single use
  - indirection with no need
  - generality nobody asked for
  - error handling for cases that cannot happen
Answer with numbered actions, or the words `no refactoring needed`.
End with a line reading exactly `VERDICT: ACCEPT` or `VERDICT: REJECT`.
GRID
    ;;
  esac
}

cat_if() {
  [ -n "${1:-}" ] && [ -f "$1" ] || return 0
  echo "--- $1 ---"
  cat "$1"
  echo
}

# --------------------------------------------------------------------------
# The gates
# --------------------------------------------------------------------------

# `git add -N` first: a brand-new test file is exactly what the red phase is
# supposed to produce, and an untracked file is invisible to `git diff`.
changed_files() {
  git add -N . >/dev/null 2>&1 || true
  git diff --name-only HEAD
}

require_work_done() {
  [ -n "$(changed_files)" ] && return 0
  echo -e "${RED}❌ The executor left the working tree untouched.${NC}"
  echo "   A run that changes nothing is a failure, not a success:"
  echo "   the phase asked for work, and no work came back."
  return 1
}

# The red phase writes a TEST. Code written in the same breath is how a test
# gets shaped around the code instead of the other way round.
require_tests_only() {
  local stray
  stray="$(changed_files | grep -vE '^(project/tests/|\.config/codeceptjs/)' || true)"
  [ -z "${stray}" ] && return 0
  echo -e "${RED}❌ The red phase changed files that are not tests:${NC}"
  while IFS= read -r file; do echo "   ~ ${file}"; done <<<"${stray}"
  return 1
}

run_tests() {
  echo -e "${BLUE}▶ ${TEST_CMD}${NC}"
  eval "${TEST_CMD}"
}

verdict_file() { printf '%s/%s.md' "${STATE_DIR}" "${1//:/-}"; }

require_verdict() {
  local file
  file="$(verdict_file "$1")"
  if [ ! -f "${file}" ] || ! grep -q '^VERDICT: ACCEPT' "${file}"; then
    echo -e "${RED}❌ No ACCEPT verdict recorded for the ${1} phase.${NC}"
    echo "   expected a file ${file} ending on a line reading exactly: VERDICT: ACCEPT"
    [ -f "${file}" ] && echo "   what it says instead:" && tail -3 "${file}"
    return 1
  fi
  echo -e "${GREEN}✅ ${1}: ACCEPT, and the grid that led to it is kept in ${file}.${NC}"
}

# --------------------------------------------------------------------------
# A phase
# --------------------------------------------------------------------------

run_phase() {
  local phase="$1" tag="${2:-}"
  require_phase "${phase}"
  echo -e "${BLUE}🔁 ${phase} phase${NC}${tag:+ (scenario: ${tag})}"

  local executor
  if ! executor="$(resolve_executor)"; then
    echo -e "${RED}❌ No AI tool to drive this phase.${NC}"
    echo "   Set TASK_AGENT_EXEC_CMD, or declare one in ${DROP_IN_DIR}/ (see its README)."
    return 1
  fi
  executor="${executor//\{\{MODEL\}\}/${TASK_AGENT_MODEL:-}}"

  case "${phase}" in
  review:*)
    # A review produces a written verdict, not an edit: the executor is asked to
    # write it where the gate reads it.
    mkdir -p "${STATE_DIR}"
    prompt_for "${phase}" "${tag}" | eval "${executor}" >"$(verdict_file "${phase}")"
    require_verdict "${phase}"
    ;;
  red)
    prompt_for "${phase}" "${tag}" | eval "${executor}"
    require_work_done
    require_tests_only
    bash "${HERE}/check-red-is-real.sh" "${tag}"
    BASE=HEAD bash "${HERE}/check-no-cheat.sh"
    ;;
  green | refactor)
    prompt_for "${phase}" "${tag}" | eval "${executor}"
    require_work_done
    run_tests
    BASE=HEAD bash "${HERE}/check-no-cheat.sh"
    ;;
  esac

  record_phase "${phase}"
  echo -e "${GREEN}✅ ${phase} phase done; the cycle now stands at: ${phase}${NC}"
}

case "${1:-}" in
doctor) doctor ;;
reset) rm -rf "${STATE_DIR}"; echo "🧹 The cycle is back to its start." ;;
red | review:red | green | review:green | refactor) run_phase "$1" "${2:-}" ;;
*)
  echo -e "${RED}❌ Unknown phase '${1:-}'. The cycle is: ${ORDER[*]}${NC}" >&2
  exit 1
  ;;
esac
