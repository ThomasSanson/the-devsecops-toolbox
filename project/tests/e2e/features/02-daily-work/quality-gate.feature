@e2e
Feature: a freshly generated project passes its own quality gate
  As a developer of a generated project
  I want the CI `code` stage to judge the files my project owns
  So that a vulnerable dependency stops my pipeline where I can fix it,
  while the toolbox answers for the tools it ships.

  # The untouched project going green on its very first pipeline is shown by
  # @install-complete (features/01-install/install.feature), on the real
  # code:megalinter job of the framework merge request. The OSV stories below
  # run the same job on GitLab, with OSV as its only scanner, next to the same
  # `task megalinter` run locally: both must read the same files and reach the
  # same verdict. ONE sentence = ONE card = ONE pixel baseline (tolerance: 0).
  @osv-scope
  Scenario: OSV checks dependencies where their owner can fix them
    # Chapter: The toolbox answers for its own tools
    # Note: GitLab shows lodash 4.17.20, a version with a known vulnerability, in the CodeceptJS lockfile the project inherits from the toolbox. Every framework tool under .config gets the same vulnerable lockfile.
    Given every framework tool in a generated project contains the same vulnerable package
    # Note: The same project, scanned once with the toolbox's own scanner configuration: the scanner's command, printed first, leaves no .config folder out. GitLab's code:megalinter job fails.
    # Note: OSV reads every framework tool and lists each lockfile with lodash 4.17.20 and advisory GHSA-35jh-r3h4-6jhm. The toolbox catches the tools it ships.
    # Copy: task megalinter
    Then the toolbox's OSV scan reports the same vulnerable framework tools
    # Chapter: The project answers for its own dependencies
    # Note: GitLab's page for the commit "test: add project dependencies". Its Files list shows four new lockfiles: one at the root, one under application/.config, and two in .config folders the project created itself, codeceptjs-extra and project-tool. The two diffs in view show lodash 4.17.20 inside.
    When the developer adds vulnerable dependencies in project-owned locations
    # Note: GitLab's page for the Copier update commit. It changes two files: .copier-answers.yml moves from 1.0.0 to 1.0.1, and .config/jq/Taskfile.yml is the one marker file the test release 1.0.1 adds.
    # Note: The project's scanner settings and its four lockfiles are not in the commit: the update leaves them alone.
    # Copy: task copier:update
    And the developer updates the framework through Copier
    # Note: After the update, the project's code:megalinter job fails. The scanner's command still leaves the framework tools out, with --experimental-exclude=.config/ansible, .config/codeceptjs and the others.
    # Note: OSV reads only the four lockfiles the project owns, .config/project-tool included, and reports lodash 4.17.20 and advisory GHSA-35jh-r3h4-6jhm in each one.
    # Copy: task megalinter
    Then OSV reports every project-owned copy of the vulnerable package
    # Chapter: Without vulnerable dependencies of its own, the project passes
    # Note: GitLab's page for the commit "test: remove project dependencies". It deletes the four project lockfiles and nothing else: the lockfiles of the framework tools are not in the commit.
    When the developer removes the vulnerable dependencies from the project's own locations
    # Note: The same job now passes. OSV still leaves the framework tools out, says "No package sources found" for the project, then "No issues found". MegaLinter ends on "Successfully linted all files without errors" and GitLab marks the job Passed.
    # Note: The framework tools are still vulnerable: as the first chapter showed, that is the toolbox's job.
    # Copy: task megalinter
    Then the project's OSV scan leaves the framework tools to the toolbox and passes

  @task-progress
  Scenario: a worker reports real task progress and preserves failures
    # Note: GitLab shows the disposable Taskfile.yml: its probe task prints "native task output", then exits with code 7.
    Given a task emits real output before failing
    # Note: The real CI job runs that task through the test suite's worker, the helper that streams a task's output back while the task runs. The log shows "native task output", then Task's own "exit status 7".
    # Note: The worker reports "Worker task exit code: 201", the code Task gives a failed command, and GitLab marks the job Failed: the failure is not swallowed.
    Then the CI job log shows the worker's real task output and keeps the job failed

  @framework-dependencies
  Scenario: the toolbox ships dependencies that pass its own OSV scan
    # Note: GitLab's page for the toolbox's own code:megalinter job, with OSV as its only scanner, checked against the live vulnerability database. The scanner's command leaves no .config folder out.
    # Note: The Scanned lines name seven files: the requirements.txt of ansible, commitizen, copier, lizard and yamllint, and the package-lock.json of codeceptjs and commitlint. The .config/megalinter folder ships only a package.json, which OSV does not read without a lockfile.
    # Note: OSV answers "No issues found", the summary marks osv-scanner green, and GitLab marks the job Passed. Package counts show as <count>: they change with every dependency update.
    # Copy: task megalinter
    Then the toolbox's own OSV scan reads the lockfile or requirements file of every tool that has one and finds no known vulnerability

  # MegaLinter's reports can hold what its secret scanners found. This story
  # runs MegaLinter the two ways a developer runs it on their own computer, and
  # lists the rights every report is left with.
  # cspell:ignore drwx -- how find prints the rights of a folder
  @report-permissions
  Scenario: MegaLinter's reports belong to the developer who ran it, and to no one else
    # Note: The developer is bootstrap, an ordinary user without administrator rights. The end of the project's MegaLinter settings keeps one check, yamllint, on the MegaLinter settings files, so that a run takes seconds. PRE_COMMANDS: [] skips the spelling dictionaries MegaLinter would install first.
    # Note: ls finds no megalinter-reports folder yet: every report on the next cards comes from the run shown there.
    # Copy: whoami && tail -n 4 .config/megalinter/config.yml && ls megalinter-reports
    Given a generated project where MegaLinter runs only yamllint on its own settings
    # Note: task megalinter:npx is the run behind task devsecops:code. MegaLinter runs as root in its own container and writes its reports straight into the project.
    # Note: find lists each report with its rights, its owner and its group. Every line reads bootstrap bootstrap, with drwx------ or -rw-------: only bootstrap can open, read or change them.
    # Copy: task megalinter:npx 2>&1 | tail -n 3; find megalinter-reports -printf '%M %u %g %p\n' | sort -k 4
    Then task megalinter:npx leaves reports only the developer can read or change
    # Note: rm -r removes the folder and every report in it with bootstrap's own rights, and ls confirms it is gone.
    # Copy: rm -r megalinter-reports && ls megalinter-reports
    And the developer can delete those reports without administrator rights
    # Note: task megalinter, the usual way to run MegaLinter on a computer, runs it in Docker on a copy of the project, then copies the reports back.
    # Note: find shows the same rights as after task megalinter:npx: bootstrap bootstrap on every line, and nothing for anyone else.
    # Copy: task megalinter 2>&1 | tail -n 5; find megalinter-reports -printf '%M %u %g %p\n' | sort -k 4
    Then task megalinter leaves its reports to the developer alone too

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

  @megalinter-config
  Scenario: every local MegaLinter task reads the settings file the project chose
    # Note: The project keeps its own MegaLinter settings in project/megalinter.yml. The toolbox does not ship that file, so a framework update never touches it. It builds on the toolbox's own file, .config/megalinter/config.yml, and keeps only ShellCheck, so that a run takes seconds.
    # Note: The last line comes from .env.dist: TASK_MEGALINTER_CONFIG=project/megalinter.yml tells the MegaLinter tasks which file to read.
    # Copy: cat project/megalinter.yml && grep TASK_MEGALINTER_CONFIG .env.dist
    Given the project names its own MegaLinter settings file in TASK_MEGALINTER_CONFIG
    # Note: task megalinter, the usual way to run MegaLinter on a machine, starts it in Docker, where the project sits in /tmp/lint. MegaLinter's own [config] line names the file it loaded: /tmp/lint/project/megalinter.yml, the project's file. The next line shows that file builds on .config/megalinter/config.yml.
    # Note: Only ShellCheck runs, as that file asks, and the task ends on "All files correctly linted with megalinter!".
    # Copy: task megalinter 2>&1 | grep -E '\[config\]|Linted|linted'
    Then task megalinter loads the project's settings file
    # Note: task megalinter:pnpm:dlx starts MegaLinter another way: pnpm downloads mega-linter-runner, and the runner starts MegaLinter's image. MegaLinter's [config] line names the same file, and the same single check runs with the same verdict.
    # Copy: task megalinter:pnpm:dlx 2>&1 | grep -E '\[config\]|Linted|linted'
    And task megalinter:pnpm:dlx loads the same settings file
