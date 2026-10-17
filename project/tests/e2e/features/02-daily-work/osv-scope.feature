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
