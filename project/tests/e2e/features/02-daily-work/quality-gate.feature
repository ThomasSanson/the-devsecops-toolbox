@e2e
Feature: a freshly generated project passes its own quality gate
  As a developer of a generated project
  I want the CI `code` stage to judge the files my project owns
  So that a vulnerable dependency stops my pipeline where I can fix it,
  while the toolbox answers for the tools it ships.

  @task-progress
  Scenario: a worker reports real task progress and preserves failures
    # Note: GitLab shows the disposable Taskfile.yml: its probe task prints "native task output", then exits with code 7.
    Given a task emits real output before failing
    # Note: The real CI job runs that task through the test suite's worker, the helper that streams a task's output back while the task runs. The log shows "native task output", then Task's own "exit status 7".
    # Note: The worker reports "Worker task exit code: 201", the code Task gives a failed command, and GitLab marks the job Failed: the failure is not swallowed.
    Then the CI job log shows the worker's real task output and keeps the job failed

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
