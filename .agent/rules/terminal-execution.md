---
trigger: always_on
description: Redirect terminal output to a log file and check it when the terminal hangs
---

# Terminal Execution & Log Monitoring

## ⛔ MANDATORY

- ✅ ALWAYS redirect command output simultaneously to the terminal and to `./tmp/exec_logs.log`
- ✅ ALWAYS use `tee` to preserve live terminal output while writing to the log file
- ✅ If the terminal response seems to hang or does not return control within a reasonable time, proactively read `./tmp/exec_logs.log` to determine the execution status
- ✅ NEVER wait indefinitely — check the log file instead of stalling

## Examples

```bash
# ✅ CORRECT — redirect output to log file while keeping terminal output
task test 2>&1 | tee ./tmp/exec_logs.log

task deploy 2>&1 | tee ./tmp/exec_logs.log

# ✅ If the terminal hangs, check the log file directly
cat ./tmp/exec_logs.log
```

## If the terminal hangs

1. Stop waiting
2. Read `./tmp/exec_logs.log` to determine whether the command succeeded, failed, or is still running
3. Act on the actual status found in the log — do not retry blindly
