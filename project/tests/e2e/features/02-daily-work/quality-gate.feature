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
    # Note: Every shipped tool receives the same vulnerable lodash lockfile in a disposable project. The saved public advisory lets the real scanner work offline.
    # Copy: find .config -name package-lock.json | sort
    Given every framework tool in a generated project contains the same vulnerable package
    # Note: OSV finds no project dependency to check. Inherited tools do not block the generated project, even when the project adds its own scanner arguments.
    # Copy: task megalinter
    When the generated project's OSV scan leaves inherited tools to the toolbox
    # Note: The toolbox's own base config reports the same vulnerable package in every shipped tool. The exclusion only belongs to generated projects.
    # Copy: task megalinter
    Then the toolbox's OSV scan reports the same vulnerable framework tools
    # Chapter: Project dependencies still block the project
    # Note: The developer adds the same package at the repository root, in a custom tool, in a similarly named tool, and in a nested .config directory. None of these locations belongs to the framework.
    # Copy: find . -name package-lock.json -not -path './.git/*' -not -path './megalinter-reports/*' | sort
    When the developer adds vulnerable dependencies in project-owned locations
    # Note: OSV reports all four project dependencies. The inherited copies remain excluded, so a blanket .config exclusion or a package-name exemption cannot pass this check.
    # Copy: task megalinter
    Then OSV reports every project-owned copy of the vulnerable package
    # Chapter: Framework updates preserve the boundary
    # Note: Copier advances the disposable project's toolbox release. The project's scanner arguments and custom tool files survive the update.
    # Copy: task copier:update TASK_COPIER_ANSWER_FILE=.config/devsecops/.copier-answers.yml TASK_COPIER_CLI_OPTS='--defaults --skip-tasks --vcs-ref 1.0.1'
    When the developer updates the framework through Copier
    # Note: The same scan reports the same four project dependencies after the update. The generated base arguments still exclude framework tools.
    # Copy: task megalinter
    Then OSV keeps the same ownership boundary after the update
    # Note: The developer removes the four disposable project lockfiles. Only inherited framework dependencies remain.
    # Copy: find .config -name package-lock.json | sort
    When the developer removes the project dependency fixtures
    # Note: OSV reports "No package sources found" and "No issues found". MegaLinter passes: an empty project scan succeeds without an error diagnostic.
    # Copy: task megalinter
    Then the project's empty OSV scan passes with a clear result

  @framework-dependencies
  Scenario: the toolbox ships dependencies that pass its own OSV scan
    # Note: The maintainer checks the actual dependency versions shipped by the toolbox. Its base config keeps framework dependencies in the scan.
    # Copy: node --eval 'const lock = require("./.config/codeceptjs/package-lock.json"); for (const [file, pkg] of Object.entries(lock.packages)) if (/\/(axios|brace-expansion|fast-uri|ip-address|multer|undici)$/.test(file)) console.log(file + ": " + pkg.version)'
    Given the maintainer checks the toolbox's shipped dependency versions
    # Note: The toolbox's base arguments contain "--no-resolve" and keep framework tools in the scan. The scanner uses the live vulnerability database.
    # Copy: grep -A 2 '^REPOSITORY_OSV_SCANNER_ARGUMENTS:' .config/megalinter/config.base.yml
    When the maintainer uses the toolbox's own scanner configuration
    # Note: OSV reads the toolbox's CodeceptJS lockfile and reports "No issues found". Known vulnerabilities fail this check.
    # Copy: cat megalinter-reports/linters_logs/REPOSITORY_OSV_SCANNER-SUCCESS.log
    Then the toolbox's dependency scan reports no known vulnerabilities
