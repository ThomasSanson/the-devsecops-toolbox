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
    # Note: The same test repository now uses the toolbox's own scanner configuration. GitLab shows the OSV error and the vulnerable framework lockfiles: the toolbox catches the tools it owns.
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
    # Note: Delete the disposable project, then read its saved CI trace. The real task output and failure remain available, with fixture credentials redacted.
    Then the failed CI job trace remains available after project cleanup

  @framework-dependencies
  Scenario: the toolbox ships dependencies that pass its own OSV scan
    # Note: GitLab shows the toolbox's CodeceptJS manifest. The test reads the dependency versions from its actual shipped lockfile.
    Given the maintainer checks the toolbox's shipped dependency versions
    # Note: The toolbox's base configuration has no framework exclusion. Its tools are scanned against the live vulnerability database.
    When the maintainer uses the toolbox's own scanner configuration
    # Note: GitLab shows the OSV job log with the shipped CodeceptJS lockfile and No issues found. The toolbox scans its own dependencies and passes.
    Then the toolbox's dependency scan reports no known vulnerabilities

  @retired-linters
  Scenario: a framework update removes retired linters and preserves project controls
    # Note: GitLab shows the project's MegaLinter settings, .config/megalinter/config.yml, on the main branch. They still name three linters MegaLinter has retired: REPOSITORY_GITLEAKS, SQL_TSQLLINT and REPOSITORY_KICS, two of them with options of their own.
    # Note: Around them sit the project's own choices: comments that explain its settings, two supported exclusions (JSON_V8R and YAML_V8R) and two strict checks. A second settings file, config.flow.yml, writes its list on one bracketed block and names REPOSITORY_GITLEAKS too.
    # Copy: http://gitlab/<lambda-user>/<project>/-/blob/main/.config/megalinter/config.yml
    Given the main branch on GitLab still names three retired linters in the project's MegaLinter settings
    # Chapter: A settings file linked outside the project stops the update
    # Note: On their own machine, the developer has added a third settings file, shared.yml, and committed it without pushing. It is a link: readlink shows it points to /workspace/shared/megalinter.yml, a file outside the project.
    # Note: The developer asks for the framework update. Copier brings the new release in, then runs the MegaLinter clean-up, which stops with "Refusing to migrate linked or external MegaLinter configuration". The task fails, so nothing is pushed and no merge request opens.
    # Note: git status lists the two files Copier had already written. No MegaLinter settings file is among them: the clean-up checks every file before it changes any.
    # Copy: readlink .config/megalinter/shared.yml && task devsecops:update; git status --short
    Then the framework update stops at a settings file linked outside the project, before it changes any MegaLinter setting
    # Chapter: Without the link, the update arrives as a clean merge request
    # Note: The developer goes back to what GitLab holds: the reset drops the commit with the link, and git clean removes the file the stopped update had added. Then they ask for the update again.
    # Note: This time the clean-up prints "removed retired references" for config.flow.yml and for config.yml, and the update ends with "Opened merge request update-framework-devsecops → main."
    # Copy: git reset -q --hard origin/main && git clean -fdq && task devsecops:update
    When the developer drops the link and asks for the framework update again
    # Note: The Changes tab of that merge request on GitLab, four files. The first two are the release itself, folded here: the version number in the answers file, and the one file this test release adds.
    # Note: In both MegaLinter files, only the lines that name a retired linter go. A comment written at the end of such a line stays, on a line of its own. JSON_V8R, YAML_V8R, FORMATTERS_DISABLE_ERRORS and ERROR_ON_MISSING_EXEC_BIT stay as they were.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1/diffs
    Then the merge request removes only the retired linters and keeps every explanation and control
    # Note: The developer, now on the update branch, asks for the update once more. Copier says "Keeping template version 1.0.1", and the clean-up runs without removing anything.
    # Note: The update ends with "Nothing to commit on update-framework-devsecops.": nothing is pushed, and the merge request stays as it was.
    # Copy: task devsecops:update
    And asking for the update a second time leaves nothing to change
