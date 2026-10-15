@e2e @betterleaks-redact-config
Feature: Betterleaks keeps a detected secret out of the CI log, and shows more only on the developer's machine
  Scenario: the CI log prints REDACTED, and the developer's own terminal shows more on request
    # Chapter: Every scan hides the whole value unless told otherwise
    # Note: GitLab shows the generated .config/betterleaks/Taskfile.yml on the main branch. Line 8, highlighted, sets TASK_BETTERLEAKS_REDACT to "100" unless the developer gives another value.
    # Note: The number is the share of a detected value, in percent, that a Betterleaks scan hides from its output. The test also checks that all six scans (full, staged and branch, each in a container or from the binary) receive 100.
    # Copy: http://gitlab/<lambda-user>/<project>/-/blob/main/.config/betterleaks/Taskfile.yml#L8
    Given GitLab shows that the generated project hides 100 percent of a detected value by default
    # Chapter: The shared CI log never prints the value
    # Note: A developer commits a made-up password in src/service.js on a new branch and pushes it. GitLab shows the file on the branch feature/synthetic-password, the whole value on line 1.
    # Note: Hiding a value protects what a scan prints, not the repository: the password stays in the file until someone removes it.
    # Copy: http://gitlab/<lambda-user>/<project>/-/blob/feature/synthetic-password/src/service.js
    When a developer pushes a branch with a synthetic password in it
    # Note: The developer opens a merge request. Its pipeline runs the generated code:betterleaks job, with no setting changed, and the job fails. GitLab shows the job page, its log scrolled to what the scan found.
    # Note: The finding names the rule generic-password, the file src/service.js and line 1, and prints "REDACTED" where the password was. Everyone on the project can read this log, so the value stays out of it.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<job-id>
    Then the Betterleaks job fails on GitLab and its log prints REDACTED instead of the password
    # Chapter: The developer sees more in their own terminal only
    # Note: To see what was caught, the developer runs the same scan in their clone, with TASK_BETTERLEAKS_REDACT=25 in the environment. The scan hides the last quarter of the value: line 1 shows the first 12 of its 16 characters, then "...". The scan still fails.
    # Copy: TASK_BETTERLEAKS_REDACT=25 task betterleaks:scan-branch
    Then the developer's terminal shows the first 12 characters of the password with the setting at 25
    # Note: The same scan with TASK_BETTERLEAKS_REDACT=0 after the command hides nothing: line 1 shows the whole value.
    # Note: Both runs stay on this machine: nothing is committed and nothing reaches GitLab. The test also checks that all six scans accept both ways of setting the value.
    # Copy: task betterleaks:scan-branch TASK_BETTERLEAKS_REDACT=0
    And the developer's terminal shows the whole password with the setting at 0
