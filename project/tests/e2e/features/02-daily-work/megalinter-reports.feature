@e2e
Feature: a freshly generated project passes its own quality gate
  As a developer of a generated project
  I want the CI `code` stage to judge the files my project owns
  So that a vulnerable dependency stops my pipeline where I can fix it,
  while the toolbox answers for the tools it ships.

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
    # Note: The developer is bootstrap, an ordinary user without administrator rights. The last lines of the project's MegaLinter settings keep one check, yamllint, on the MegaLinter settings files only, so that a run takes seconds. PRE_COMMANDS: [] skips the spelling dictionaries MegaLinter would install first.
    # Note: ls finds no megalinter-reports folder yet: every report on the next cards comes from the run shown there.
    # Copy: whoami && tail -n 4 .config/megalinter/config.yml && ls megalinter-reports
    Given a generated project where MegaLinter runs only yamllint on its own settings
    # Note: task megalinter:npx is the run behind task devsecops:code. MegaLinter runs as root in its own container and writes its reports straight into the project. The task's last step, in green, gives them to the user who ran it with chown, then takes every right away from everyone else with chmod -R go-rwx.
    # Note: find lists each report with its rights, its owner and its group. Every line reads bootstrap bootstrap. In drwx------ and -rw-------, the letters are bootstrap's own rights to open, read and change, and the dashes after them mean nothing for anyone else.
    # Copy: task megalinter:npx 2>&1 | tail -n 3; find megalinter-reports -printf '%M %u %g %p\n' | sort -k 4
    Then task megalinter:npx leaves reports only the developer can read or change
    # Note: rm -r removes the folder and every report in it with bootstrap's own rights, without sudo, and ls confirms it is gone.
    # Copy: rm -r megalinter-reports && ls megalinter-reports
    And the developer can delete those reports without administrator rights
    # Note: task megalinter, the usual way to run MegaLinter on a computer, runs it in Docker on a copy of the project, then copies the reports back as bootstrap. Its last step, in green, is chmod -R go-rwx megalinter-reports.
    # Note: find shows the same rights as after task megalinter:npx: bootstrap bootstrap on every line, and nothing for anyone else.
    # Copy: task megalinter 2>&1 | tail -n 5; find megalinter-reports -printf '%M %u %g %p\n' | sort -k 4
    Then task megalinter leaves its reports to the developer alone too

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
