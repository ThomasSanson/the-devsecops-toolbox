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
    # Chapter: Framework vulnerability: the project passes
    # Note: GitLab shows lodash 4.17.20 in the inherited CodeceptJS lockfile. The same vulnerable fixture is present in every framework tool.
    Given every framework tool in a generated project contains the same vulnerable package
    # Note: GitLab shows the inherited job's OSV log: no package sources found and No issues found. The vulnerable framework tools leave the project pipeline green.
    When the generated project's OSV scan leaves inherited tools to the toolbox
    # Note: GitLab shows the OSV error and the vulnerable framework lockfiles. The toolbox's own scanner configuration catches the tools it owns.
    Then the toolbox's OSV scan reports the same vulnerable framework tools
    # Chapter: Project vulnerability: the project fails
    # Note: GitLab shows the same vulnerable package in .config/project-tool. The fixture is also added at the repository root and in two other project-owned locations.
    When the developer adds vulnerable dependencies in project-owned locations
    # Note: GitLab shows the OSV error: lodash 4.17.20, advisory GHSA-35jh-r3h4-6jhm, and all four project-owned lockfiles, including .config/project-tool/package-lock.json. This finding blocks the inherited code:megalinter job.
    Then OSV reports every project-owned copy of the vulnerable package
    # Chapter: Framework updates preserve the boundary
    # Note: GitLab shows version 1.0.1 after a real Copier update. Project settings and dependency files survive.
    When the developer updates the framework through Copier
    # Note: GitLab shows the same OSV advisory and project lockfiles after the Copier update. These project vulnerabilities still block the job.
    Then OSV keeps the same ownership boundary after the update
    # Note: The project fixtures have been removed. GitLab shows that the vulnerable inherited CodeceptJS fixture is still there.
    When the developer removes the project dependency fixtures
    # Note: GitLab shows No issues found again. Only vulnerable framework tools remain, so the generated project's pipeline succeeds.
    Then the project's empty OSV scan passes with a clear result

  @task-progress
  Scenario: a worker reports real task progress and preserves failures
    # Note: GitLab shows the disposable Taskfile.yml: the probe prints "native task output", then exits with an error.
    Given a task emits real output before failing
    # Note: The real GitLab job is Failed. The test checks that the worker forwards every byte of the task output and preserves its failure.
    When the worker reports the output and keeps the failed task status

  @framework-dependencies
  Scenario: the toolbox ships dependencies that pass its own OSV scan
    # Note: GitLab shows the toolbox's CodeceptJS manifest. The test reads the dependency versions from its actual shipped lockfile.
    Given the maintainer checks the toolbox's shipped dependency versions
    # Note: The toolbox's base configuration has no framework exclusion. Its tools are scanned against the live vulnerability database.
    When the maintainer uses the toolbox's own scanner configuration
    # Note: GitLab shows the OSV job log with the shipped CodeceptJS lockfile and No issues found. The toolbox scans its own dependencies and passes.
    Then the toolbox's dependency scan reports no known vulnerabilities
