---
trigger: always_on
description: Core stability and integrity rules to prevent unauthorized modifications
---

# Stability & Integrity

## 1. Respect Existing Architecture

- **Do not modify, add, or break existing core functional code unless strictly necessary for the task's completion.**
- The agent must prioritize adapting to the current architecture and logic over introducing new methodologies.

## 2. Restricted Files & Directories

- **Do not modify the content of the .config directory or the root Taskfile.yml file under any circumstances.**
- **A failure rooted in `.config/` is a framework bug, not a project bug.** When a job fails because of something the framework ships (a vulnerable package in a `.config/*/package-lock.json`, a linter setting, a task definition), do not patch it in this repository: the next `task copier:update` would overwrite the change, and every project generated from the template fails the same way.
  State the cause, name the file, and point to The DevSecOps Toolbox (https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox), where the fix is made once in a merge request and reaches every project through `task copier:update`. Look at its open merge requests first: the fix may already be on its way.
