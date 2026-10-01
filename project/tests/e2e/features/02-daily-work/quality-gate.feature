@e2e
Feature: a freshly generated project passes its own quality gate
  As a developer who just scaffolded a project from the template
  I want `task megalinter` to come back green on the untouched scaffold
  So that the CI `code` stage is green on day one, before I write any code.

  # The generated project ships a full MegaLinter suite (~35 linters) and a CI
  # `code` stage that runs it. This story renders a vanilla project and runs that
  # exact linter suite on it, untouched, proving the gate is green out of the box
  # and that the secret + dependency scanners find nothing. ONE Gherkin sentence
  # = ONE card = ONE pixel baseline (tolerance: 0); every card twins its terminal
  # frame with an exit-code / verdict check of the same fact.
  @quality-gate
  Scenario: the untouched scaffold's linter suite comes back green
    # Note: A project straight out of the template: nothing edited yet, a clean git tree sitting at version 0.1.0.
    # Copy: git status --short ; cat VERSION
    Given a freshly generated project, still untouched
    # Note: The developer runs the project's whole linter suite (task megalinter, the same command the CI code stage runs) on the untouched scaffold. It comes back green: MegaLinter exits 0, so the gate passes.
    # Copy: task megalinter
    When the developer runs the whole linter suite on it
    # Note: The secret and dependency scanners (betterleaks, trivy, trufflehog, grype) all report zero findings, so the scaffold has nothing leaking and no known-vulnerable dependency out of the box.
    # Copy: task megalinter
    Then the secret and dependency scanners all come back clean

  @osv-scope
  Scenario: OSV checks dependencies where their owner can fix them
    # Chapter: Framework tools are checked in the toolbox
    # Note: The GitLab job lists every shipped tool's lockfile and opens the vulnerable lodash fixture. The saved public advisory lets the real scanner work offline.
    # Copy: find .config -name package-lock.json | sort
    Given every framework tool in a generated project contains the same vulnerable package
    # Note: GitLab marks code:megalinter as "Passed". OSV reports "No package sources found" and "No issues found": inherited tools do not block the generated project.
    # Copy: task megalinter
    When the generated project's OSV scan leaves inherited tools to the toolbox
    # Note: GitLab marks the same job as "Failed" with the toolbox's own base config. OSV lists the vulnerable package in all eight framework tools. The exclusion only belongs to generated projects.
    # Copy: task megalinter
    Then the toolbox's OSV scan reports the same vulnerable framework tools
    # Chapter: Project dependencies still block the project
    # Note: The GitLab job lists the four added lockfiles: the repository root, a custom tool, a similarly named tool, and a nested .config directory. None of these locations belongs to the framework.
    # Copy: find . -name package-lock.json -not -path './.git/*' -not -path './megalinter-reports/*' | sort
    When the developer adds vulnerable dependencies in project-owned locations
    # Note: OSV reports all four project dependencies. The inherited copies remain excluded, so a blanket .config exclusion or a package-name exemption cannot pass this check.
    # Copy: task megalinter
    Then OSV reports every project-owned copy of the vulnerable package
    # Chapter: Framework updates preserve the boundary
    # Note: GitLab shows "1.0.1" in .copier-answers.yml after the real Copier update. The regression checks that the project's scanner arguments and custom tool files survive.
    # Copy: task copier:update TASK_COPIER_ANSWER_FILE=.config/devsecops/.copier-answers.yml TASK_COPIER_CLI_OPTS='--defaults --skip-tasks --vcs-ref 1.0.1'
    When the developer updates the framework through Copier
    # Note: The same scan reports the same four project dependencies after the update. The generated base arguments still exclude framework tools.
    # Copy: task megalinter
    Then OSV keeps the same ownership boundary after the update
    # Note: The GitLab job's file listing contains only the eight inherited framework lockfiles. The four project fixtures have been removed.
    # Copy: find .config -name package-lock.json | sort
    When the developer removes the project dependency fixtures
    # Note: OSV reports "No package sources found" and "No issues found". MegaLinter passes: an empty project scan succeeds without an error diagnostic.
    # Copy: task megalinter
    Then the project's empty OSV scan passes with a clear result

  @task-progress
  Scenario: a worker reports real task progress and preserves failures
    # Note: GitLab shows the disposable Taskfile.yml: the probe prints "native task output", then exits with an error.
    # Copy: cat Taskfile.yml
    Given a task emits real output before failing
    # Note: The real GitLab job is "Failed" and its log shows "native task output" and "exit status 7". The regression also checks that every progress message contains the task's actual output.
    # Copy: task probe
    When the worker reports the output and keeps the failed task status

  @framework-dependencies
  Scenario: the toolbox ships dependencies that pass its own OSV scan
    # Note: The real GitLab job lists the dependency versions from the toolbox's shipped lockfile, including axios, multer and undici.
    # Copy: node --eval 'const lock = require("./.config/codeceptjs/package-lock.json"); for (const [file, pkg] of Object.entries(lock.packages)) if (/\/(axios|brace-expansion|fast-uri|ip-address|multer|undici)$/.test(file)) console.log(file + ": " + pkg.version)'
    Given the maintainer checks the toolbox's shipped dependency versions
    # Note: The GitLab job opens the toolbox's base scanner arguments: "--no-resolve" with no framework exclusion. The scanner uses the live vulnerability database.
    # Copy: grep -A 2 '^REPOSITORY_OSV_SCANNER_ARGUMENTS:' .config/megalinter/config.base.yml
    When the maintainer uses the toolbox's own scanner configuration
    # Note: GitLab marks code:megalinter as "Passed". Its native OSV report shows the CodeceptJS lockfile was scanned and says "No issues found". Known vulnerabilities fail this check.
    # Copy: cat megalinter-reports/linters_logs/REPOSITORY_OSV_SCANNER-SUCCESS.log
    Then the toolbox's dependency scan reports no known vulnerabilities
