@e2e @betterleaks-redact-config
Feature: developers can configure how much Betterleaks hides in scan logs
  Scenario: all six scans hide whole values by default and accept an override
    # Note: The generated project carries the same redaction setting for full, staged and branch scans, in Docker and binary mode.
    Given a generated project exposes the Betterleaks redaction setting
    # Copy: task betterleaks:scan-full --dry --verbose TASK_BETTERLEAKS_MODE=binary
    Then all six scans use 100 percent redaction by default
    # Copy: TASK_BETTERLEAKS_REDACT=25 task betterleaks:scan-full --dry --verbose TASK_BETTERLEAKS_MODE=binary
    When redaction is set to 25 through the environment all six scans use 25
    # Copy: task betterleaks:scan-full --dry --verbose TASK_BETTERLEAKS_MODE=binary TASK_BETTERLEAKS_REDACT=0
    Then a task variable can set redaction to zero in all six scans
