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
#   The cycle is for whoever drives it. Nothing here is reserved for an AI
#   assistant: run a phase with no tool declared and it checks the work YOU just
#   did, against the same gates.
#
#   An AI assistant is an OPTION, not a requirement. When one is declared it is
#   a command, never a product: TASK_AGENT_EXEC_CMD reads the prompt on standard
#   input and edits the working tree, and a run that leaves `git diff` empty is
#   a failure. Tools are declared one file at a time under
#   .config/devsecops/agents.d/ — see the README there. The framework holds no
#   model name and no vendor of its own.
#
# USAGE:
#   task devsecops:test:tdd:doctor
#   task devsecops:test:tdd:red -- @my-tag
#   task devsecops:test:tdd:review:red
#   task devsecops:test:tdd:green -- @my-tag
#   ...
#
# ENVIRONMENT VARIABLES:
#   TASK_AGENT_EXEC_CMD    the command that reads a prompt on stdin and edits
#                          the working tree ({{MODEL}} is replaced by the model)
#   TASK_AGENT_MODEL       the model to pass to it
#   TASK_AGENT_TEST_CMD    how this project runs its tests (default: task test)
#   TASK_AGENT_BRIEF       the issue to work from (default: tmp/agent/brief.md)
#   TASK_AGENT_STATE_DIR   where the phase is recorded (default: tmp/agent)
#   TASK_AGENT_DROP_IN_DIR where the tool drop-ins live
#
# EXIT CODES:
#   0  the phase ran and its gate accepted the result
#   1  out of order, no work in the tree, or a gate refused
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
# What the work IS, in the words of whoever asked for it. Written once, read by
# every phase. Without it the phases still run — they just have nothing to say.
BRIEF_FILE="${TASK_AGENT_BRIEF:-${STATE_DIR}/brief.md}"
DROP_IN_DIR="${TASK_AGENT_DROP_IN_DIR:-.config/devsecops/agents.d}"
TEST_CMD="${TASK_AGENT_TEST_CMD:-task test}"

# The sequence, and nothing else. `red` opens it: the issue and the branch are a
# human's business, and stay one.
ORDER=(red review:red green review:green refactor)

predecessor() {
  local wanted="$1" previous=''
  for phase in "${ORDER[@]}"; do
    if [ "${phase}" = "${wanted}" ]; then
      printf '%s' "${previous}"
      return 0
    fi
    previous="${phase}"
  done
  printf ''
}

successor() {
  local after="$1" take=0
  for phase in "${ORDER[@]}"; do
    if [ "${take}" -eq 1 ]; then
      printf '%s' "${phase}"
      return 0
    fi
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

# A phase runs after the one before it — or after ITSELF, which is how a
# rejected phase is redone. The order cannot be skipped; repeating a step is not
# skipping one, and a review that rejects sends the work straight back here.
# The refusal names what was recorded and what it is waiting for, so the way
# forward is never a guess.
require_phase() {
  local wanted="$1" needed current next
  needed="$(predecessor "${wanted}")"
  current="$(recorded_phase)"
  if [ "${current}" = "${needed}" ] || [ "${current}" = "${wanted}" ]; then return 0; fi
  next="${ORDER[0]}"
  [ -n "${current}" ] && next="$(successor "${current}")"
  echo -e "${RED}❌ The ${wanted} phase cannot start yet.${NC}"
  echo "   recorded phase : ${current:-(none: the cycle has not started)}"
  echo "   expected phase : ${needed:-(none: this phase opens the cycle)}"
  echo "   next step      : task devsecops:test:tdd:${next}"
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
  echo -e "${BLUE}🔎 AI tools this machine holds (declaring one is optional)${NC}"
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
    echo "   no AI tool: the phases will check the work you do yourself, against the same gates"
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
  # WHAT to build. The gates can check how the work was done; nothing can guess
  # what the work IS, so it is written down: the brief is the issue, in the words
  # of whoever opened it, and every phase reads the same one.
  cat_if "${BRIEF_FILE}"
  case "${phase}" in
  red)
    echo "Write the failing test, and nothing else. Touch test files only."
    rejected_verdict review:red
    cat_if .agent/workflows/tdd-step1-red.md
    cat_if .agent/rules/tests-integrity.md
    cat_if "$(reference_story)"
    ;;
  green)
    echo "Write the smallest code that makes that test pass. Do not touch the test."
    rejected_verdict review:green
    cat_if .agent/workflows/tdd-step2-green.md
    ;;
  refactor)
    echo "Improve the code without changing what it does. Do not touch the test."
    cat_if .agent/workflows/tdd-step3-refactor.md
    ;;
  review:red)
    cat <<'GRID'
Be the devil's advocate on the test that was just written, and answer each point:
  - does a stranger reading the test alone understand what is tested?
  - is the vocabulary the business's, or the implementation's?
  - did the run fail on the assertion, or on its way to it?
  - would the test still pass if the rule it claims to protect were broken?
GRID
    # Ask the storyboard question only where storyboards exist. A project whose
    # tests are pytest files cannot answer it, and a grid with an unanswerable
    # question rejects for ever.
    [ -d project/tests/e2e/storyboards ] && echo "  - does every sentence map to a storyboard card?"
    cat <<'GRID'
End with a line reading exactly `VERDICT: ACCEPT` or `VERDICT: REJECT`.
GRID
    # The evidence the gate just read, so the review judges the same facts
    # instead of guessing at them — it may have no way to run the suite itself.
    if [ -n "${tag}" ]; then
      echo
      echo "The red gate has already run the suite and read its report. Its verdict:"
      # Informational: a prompt must never fail because a quotation failed.
      bash "${HERE}/check-red-is-real.sh" "${tag}" 2>&1 | sed 's/\x1b\[[0-9;]*m//g; s/^/  /' || true
    fi
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

# A review that REJECTED comes back to the phase that produced the work — with
# its grid attached. A loop whose executor never reads why it was rejected
# repeats itself, which is not a loop, it is a stutter.
rejected_verdict() {
  local file
  file="$(verdict_file "$1")"
  [ -f "${file}" ] && grep -q "VERDICT: REJECT" "${file}" || return 0
  echo "The previous attempt was REJECTED by the ${1} step. Address EVERY point below."
  cat_if "${file}"
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

# The red phase runs them too, and a failure here is the POINT — so the exit
# code is ignored and the verdict is left to check-red-is-real, which reads the
# report the run leaves behind. Running them here is what makes that report
# exist at all: a phase that only reads a report can be handed a stale one.
run_tests_expecting_failure() {
  echo -e "${BLUE}▶ ${TEST_CMD}${NC}"
  eval "${TEST_CMD}" || true
}

verdict_file() { printf '%s/%s.md' "${STATE_DIR}" "${1//:/-}"; }

require_verdict() {
  local file
  file="$(verdict_file "$1")"
  if [ ! -f "${file}" ] || ! grep -q '^VERDICT: ACCEPT' "${file}"; then
    echo -e "${RED}❌ No ACCEPT verdict recorded for the ${1} phase.${NC}"
    echo "   expected a file ${file} ending on a line reading exactly: VERDICT: ACCEPT"
    echo "   a REJECT is not a dead end: fix what it names, run task devsecops:test:tdd:${1#review:} again, then this step"
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

  # The AI tool is a convenience, never a requirement. With one, the phase hands
  # it the prompt and then checks what came back; without one, the phase checks
  # the work YOU just did. The gates are the point — they do not care who typed.
  if [ ! -f "${BRIEF_FILE}" ]; then
    echo -e "   ${YELLOW}no brief at ${BRIEF_FILE} — write the issue there so every phase works from it.${NC}"
  fi

  local executor=''
  if executor="$(resolve_executor)"; then
    executor="${executor//\{\{MODEL\}\}/${TASK_AGENT_MODEL:-}}"
    echo -e "   handed to: ${executor}"
  else
    executor=''
    echo -e "   ${YELLOW}no AI tool declared — checking the work in this tree instead.${NC}"
  fi

  case "${phase}" in
  review:*)
    # A review produces a written verdict, not an edit. With a tool, it writes
    # it where the gate reads it; without one, you do — the grid is printed.
    mkdir -p "${STATE_DIR}"
    if [ -n "${executor}" ]; then
      prompt_for "${phase}" "${tag}" | eval "${executor}" >"$(verdict_file "${phase}")"
    else
      echo "   Answer this grid in $(verdict_file "${phase}"), last line 'VERDICT: ACCEPT':"
      prompt_for "${phase}" "${tag}" | sed 's/^/   /'
    fi
    require_verdict "${phase}"
    ;;
  red)
    if [ -n "${executor}" ]; then prompt_for "${phase}" "${tag}" | eval "${executor}"; fi
    require_work_done
    require_tests_only
    run_tests_expecting_failure
    bash "${HERE}/check-red-is-real.sh" "${tag}"
    BASE=HEAD bash "${HERE}/check-no-cheat.sh"
    ;;
  green | refactor)
    if [ -n "${executor}" ]; then prompt_for "${phase}" "${tag}" | eval "${executor}"; fi
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
