#!/usr/bin/env bash
#
# ============================================================================
# Agent runner — "one task, its own exit code, its own log"
# ============================================================================
#
# DESCRIPTION:
#   An assistant that types `task test | tail` reads the exit code of tail, not
#   the one of the test, and a trailing `; echo done` turns any failure into a
#   zero. This runner owns the run instead: it starts the task from the
#   repository root, sends everything the task prints to a log of its own,
#   writes the verdict to a status file, and exits with the task's own code.
#
#     tmp/agent-runs/<run>/output.log   everything the task printed
#     tmp/agent-runs/<run>/status       task, state, exit_code, log
#     tmp/agent-runs/latest             the run started last
#
#   The status file says `state: running`, with no exit code, until the task
#   ends, then `finished` or `timed-out`. A run that never came back is never
#   read as a success.
#
# USAGE:
#   task -x devsecops:agent:run -- <task> [args...]
#   task -x devsecops:agent:run -- test -- --grep "@my-tag"
#
#   -x hands the task's exit code to the shell. Without it, Task answers 201
#   for every failure, and the status file still holds the real code.
#
# ENVIRONMENT VARIABLES:
#   TASK_DEVSECOPS_AGENT_RUN_TIMEOUT   seconds before the task is stopped
#                                      (default: 1800)
#
# EXIT CODES:
#   the task's own exit code once it finished
#   124  the task ran past the time limit and was stopped
#   2    no task given
#
# ============================================================================

set -uo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: task -x devsecops:agent:run -- <task> [args...]" >&2
  exit 2
fi

TIMEOUT="${TASK_DEVSECOPS_AGENT_RUN_TIMEOUT:-1800}"
RUN="tmp/agent-runs/$(date -u +%Y%m%dT%H%M%SZ)-$$"
LOG="${RUN}/output.log"
TASK_LINE="$*"

write_status() {
  printf 'task: %s\nstate: %s\nexit_code: %s\nlog: %s\n' "${TASK_LINE}" "$1" "$2" "${LOG}" >"${RUN}/status"
}

mkdir -p "${RUN}"
ln -sfn "${RUN##*/}" tmp/agent-runs/latest
write_status running ""

# No terminal to read from: a task that asks a question fails at once instead
# of waiting for the time limit.
SECONDS=0
timeout --kill-after=10 "${TIMEOUT}" task -x "$@" </dev/null >"${LOG}" 2>&1
code=$?

# timeout answers 124, or 137 when the task ignored TERM and had to be killed.
# The clock tells either apart from a task that exits 124 or 137 on its own.
state=finished
if [ "${SECONDS}" -ge "${TIMEOUT}" ] && { [ "${code}" -eq 124 ] || [ "${code}" -eq 137 ]; }; then
  state=timed-out
  code=124
fi

write_status "${state}" "${code}"
cat "${RUN}/status"
exit "${code}"
