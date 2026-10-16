---
trigger: always_on
description: Run tasks through the toolbox's runner, which keeps each task's exit code and log, and read its status file instead of waiting
---

# Terminal Execution & Log Monitoring

## ⛔ MANDATORY

- ✅ Run a task through the runner: `task -x devsecops:agent:run -- <task> [args]`. It starts the task from the repository root, writes everything the task prints to `tmp/agent-runs/<run>/output.log`, and ends on the run's status file: the task, its `state`, its `exit_code` and the path of the log.
- ✅ Read the verdict in `tmp/agent-runs/latest/status`, or in the runner's own exit code. `-x` hands the task's exit code to the shell; without it, Task answers 201 for any failure.
- ✅ `state: timed-out` with `exit_code: 124` means the task ran past its time limit (1800 seconds; set `TASK_DEVSECOPS_AGENT_RUN_TIMEOUT` to change it). `state: running` with no exit code means the run has not come back. Neither one is a success.
- ❌ Never pipe a `task` run into `tee`, `tail` or `grep`: the pipe returns the last command's exit code, not the task's. The runner's status file keeps the real one, whatever the shell does after it.
- ✅ No runner (only the AI files are installed): send the output to a log and keep the exit code, `mkdir -p tmp && <command> > tmp/exec_logs.log 2>&1; echo "exit code $?"`, then read the log.
- ✅ NEVER wait indefinitely — if the terminal does not return control within a reasonable time, read the status file and the log instead of stalling

## Examples

```bash
task -x devsecops:agent:run -- test -- --grep "@my-tag"
cat tmp/agent-runs/latest/status
tail -n 50 tmp/agent-runs/latest/output.log
```

## If the terminal hangs

1. Stop waiting
2. Read `tmp/agent-runs/latest/status`: `running`, `finished` with its `exit_code`, or `timed-out`
3. Act on the actual status found there — do not retry blindly
