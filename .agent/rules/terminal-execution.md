---
trigger: always_on
description: Redirect terminal output to a log file and check it when the terminal hangs
---

# Terminal Execution & Log Monitoring

## ⛔ MANDATORY

- ✅ Send a long command's output to a log and keep its exit code: `mkdir -p tmp && task test > tmp/exec_logs.log 2>&1`, then read the log.
- ❌ Never pipe a task into `tee`, `tail` or `grep`: the pipe returns the last command's exit code, not the task's.
- ✅ If the terminal response seems to hang or does not return control within a reasonable time, proactively read `tmp/exec_logs.log` to determine the execution status
- ✅ NEVER wait indefinitely — check the log file instead of stalling

## Examples

```bash
mkdir -p tmp && task test > tmp/exec_logs.log 2>&1
tail -n 50 tmp/exec_logs.log
```

## If the terminal hangs

1. Stop waiting
2. Read `tmp/exec_logs.log` to determine whether the command succeeded, failed, or is still running
3. Act on the actual status found in the log — do not retry blindly
