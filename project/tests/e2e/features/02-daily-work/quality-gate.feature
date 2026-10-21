@e2e
Feature: a freshly generated project passes its own quality gate
  As a developer of a generated project
  I want the CI `code` stage to judge the files my project owns
  So that a vulnerable dependency stops my pipeline where I can fix it,
  while the toolbox answers for the tools it ships.

  # Grype, another scanner MegaLinter runs, takes its settings from
  # .config/grype/config.yml. Its exclude list names the folders that hold no
  # code of the project's own. A pattern that starts with ./ only matches at
  # the root of the project, so the same folder one level down was scanned
  # (issue #171). MegaLinter also passes Grype the folders of its own
  # EXCLUDED_DIRECTORIES setting, so the terminal runs the grype binary of the
  # project's MegaLinter image with the settings file alone.
  @grype-excludes
  Scenario: Grype skips the folders its settings list at any depth and still reports the project's own dependencies
    # Note: A project generated from the toolbox, with an API under project/api. Its own lockfile, project/api/package-lock.json, pins lodash 4.17.20, a version with a known vulnerability.
    # Note: The same lockfile sits in three folders of the API that hold none of its code: .cache, where package managers keep their downloads, and vendor and venv, where they install libraries.
    # Copy: grep -H -A1 '"node_modules/lodash"' $(find project -name package-lock.json | sort)
    Given a generated project's API holds the same vulnerable lockfile in its own folder and in its .cache, vendor and venv folders
    # Note: Grype scans the project with its settings file and saves what it finds as JSON. jq, a JSON reader, then lists the files those findings come from.
    # Note: There is one: /project/api/package-lock.json, the API's own lockfile. Nothing comes from .cache, vendor or venv.
    # Copy: grype dir:. -q --config .config/grype/config.yml -o json > /tmp/grype.json && jq -r '.matches[].artifact.locations[].path' /tmp/grype.json | sort -u
    When the developer scans the project with Grype's settings, it reports the API's own lockfile only
    # Note: The settings file MegaLinter hands Grype. Every folder of its exclude list starts with **/ and ends with /**, like the node_modules line: Grype skips that folder wherever it sits, at the root or deeper.
    # Copy: cat .config/grype/config.yml
    Then Grype's settings file skips every folder of its list at any depth
  # MegaLinter starts by installing the spelling dictionaries with npm. This
  # story runs it on the developer's computer against a registry that never
  # answers, and times how long that install holds the run.
  @dictionary-timeout
  Scenario: MegaLinter stops waiting for the spelling dictionaries after two minutes
    # Note: The last lines of the project's MegaLinter settings keep one check, CSpell, on the MegaLinter settings files only, so that the run stays short. NPM_CONFIG_REGISTRY sends npm to a test server that accepts the connection and never answers. Its address changes with every run.
    # Note: MegaLinter passes its settings as environment variables to the commands it runs before the checks, so the npm install of the spelling dictionaries asks that server.
    # Copy: tail -n 4 .config/megalinter/config.yml
    Given a generated project whose MegaLinter settings send npm to a registry that never answers
    # Note: task megalinter runs MegaLinter in Docker, and sed keeps the part of its log about the command it runs first: timeout 120 npm install -g, with the five spelling dictionaries.
    # Note: After 120 seconds, timeout stops npm. MegaLinter prints "[Pre] error:" and the reason: "npm could not install the CSpell dictionaries within 120 seconds." The test also checks that the whole run took less than five minutes.
    # Copy: task megalinter 2>&1 | sed -n '/^\[Pre\] run/,/^$/p'
    Then task megalinter stops the dictionary install after 120 seconds and says why

  @task-progress
  Scenario: a worker reports real task progress and preserves failures
    # Note: GitLab shows the disposable Taskfile.yml: its probe task prints "native task output", then exits with code 7.
    Given a task emits real output before failing
    # Note: The real CI job runs that task through the test suite's worker, the helper that streams a task's output back while the task runs. The log shows "native task output", then Task's own "exit status 7".
    # Note: The worker reports "Worker task exit code: 201", the code Task gives a failed command, and GitLab marks the job Failed: the failure is not swallowed.
    Then the CI job log shows the worker's real task output and keeps the job failed

  # Lizard, the complexity checker the code stage runs, used to get only the
  # options of TASK_LIZARD_CLI_OPTS: what a developer typed after
  # `task lizard --` never reached it (issue #97). The terminal runs the real
  # task in a generated project, pointed at the developer's own src folder, once
  # without options and once with a lower complexity limit.
  @lizard-cli-args
  Scenario: Lizard receives the options a developer types after task lizard --
    # Note: A project generated from the toolbox, with one file of the developer's own: src/shipping.py. Its function shipping_cost has two if lines and one elif, so there are four paths through it.
    # Note: Lizard counts those paths as the function's cyclomatic complexity, CCN in its tables.
    # Copy: cat src/shipping.py
    Given a generated project holds a function with four paths through it
    # Note: The developer runs Lizard through the toolbox. TASK_LIZARD_PATH_TO_ANALYSE=src points it at the developer's own code. Task first prints the script it runs, and that script's last line starts Lizard.
    # Note: The table gives shipping_cost a CCN of 4. Lizard answers "No thresholds exceeded (cyclomatic_complexity > 15 ...)": 15 is its default limit. The run ends with exit code 0. Versions show as <version>: they move with each update.
    # Copy: TASK_LIZARD_PATH_TO_ANALYSE=src task lizard; echo "exit code: $?"
    When the developer runs task lizard, the function stays under Lizard's default limit of 15
    # Note: The same command with --CCN 3 after the two dashes. The last line of the script now ends with --CCN 3: Task hands the option to Lizard.
    # Note: Lizard lists shipping_cost under "Warnings (cyclomatic_complexity > 3 ...)" and fails, so Task stops with exit code 201, the code it gives a failed command.
    # Copy: TASK_LIZARD_PATH_TO_ANALYSE=src task lizard -- --CCN 3; echo "exit code: $?"
    Then with --CCN 3 after the two dashes, Lizard flags the function and the run fails

  @markdown-tables
  Scenario: MegaLinter keeps a table with emoji the way markdownlint reads it
    # Note: A project generated by the toolbox, with two Markdown files committed. In docs/status.md the pipes of the table line up on screen: an emoji such as ✅ takes two columns, so its cell gets one space less.
    # Note: docs/status-by-count.md holds the same table the way markdown-table-formatter rewrote it. That tool counts ✅ as one column, so both emoji rows end one column too far right.
    # Note: The last five lines of the project's MegaLinter settings, on top, limit the run to the Markdown checks on these two files.
    # Copy: tail -n 5 .config/megalinter/config.yml docs/status.md docs/status-by-count.md
    Given a generated project holds a status table with emoji, its pipes lined up on screen, and a copy padded by character count
    # Note: The developer runs MegaLinter twice. This is the second run. Like the first one, it fixes nothing, the summary says 0 under Fixed: both tables stay as they were, and both runs give the same verdict.
    # Note: The summary lists markdownlint alone. It flags lines 5 and 6 of docs/status-by-count.md, the two emoji rows, with MD060 "Table pipe does not align with header", and nothing in docs/status.md.
    # Note: MegaLinter counts these Markdown findings as non-blocking, so the run ends with "exit code 0".
    # Copy: task megalinter; echo "exit code $?"
    Then MegaLinter leaves both tables as they are, run after run, and markdownlint flags only the copy padded by character count

  # Trivy, a scanner MegaLinter runs, takes its settings from
  # .config/trivy/config.yml: MegaLinter hands it that file with --config.
  # trivyignore.yml, the file config.yml names as its ignorefile, only lists
  # findings the project accepts, so a folder list written there skipped
  # nothing (issue #149). MegaLinter also passes Trivy the folders of its own
  # EXCLUDED_DIRECTORIES setting, so the terminal runs the trivy binary of the
  # project's MegaLinter image with the settings file alone.
  @trivy-skip-dirs
  Scenario: Trivy skips the folders its settings list and still reports the project's own dependencies
    # Note: A project generated from the toolbox holds the same lockfile twice. package-lock.json, at the root, lists the project's own dependencies. vendor/acme/widget/package-lock.json stands for a library a package manager installed under vendor/. Both pin lodash 4.17.20, a version with a known vulnerability.
    # Copy: grep -H -A1 '"node_modules/lodash"' package-lock.json vendor/acme/widget/package-lock.json
    Given a generated project holds the same vulnerable lockfile at its root and in a library under vendor/
    # Note: Trivy scans the project with its settings file and saves what it finds as JSON. jq, a JSON reader, then lists the files in which Trivy found a vulnerability.
    # Note: There is one: package-lock.json, the project's own lockfile. vendor/acme/widget/package-lock.json pins the same lodash 4.17.20 and is not listed: Trivy skipped the vendor folder.
    # Copy: trivy fs --quiet --scanners vuln --config .config/trivy/config.yml --format json --output /tmp/trivy.json . && jq -r '.Results[] | select(.Vulnerabilities) | .Target' /tmp/trivy.json
    When the developer scans the project with Trivy's settings, it reports the root lockfile and skips vendor/
    # Note: The settings file MegaLinter hands Trivy. Its scan.skip-dirs list names vendor next to the other folders that hold no code of the project's own, such as .cache, .git and venv. Trivy reads the list from this file.
    # Note: Its ignorefile line still points Trivy to trivyignore.yml, the file of findings the project accepts.
    # Copy: cat .config/trivy/config.yml
    Then Trivy's settings file lists the folders to skip and still points to the file of accepted findings

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
    # Chapter: A settings file with a typo stops the update
    # Note: The developer has undone what the stopped update wrote, then replaced the link with a file of their own, shared.yml, committed without pushing. cat shows a typo: its list opens with a bracket that never closes.
    # Note: The clean-up names the file and the line where the list opens, line 3 of shared.yml. It says "No settings file was changed" and asks to fix the file, then ask for the update again. The task fails, so nothing is pushed.
    # Note: git status lists only the two files Copier had already written.
    # Copy: cat .config/megalinter/shared.yml && task devsecops:update; git status --short
    Then the framework update stops at a settings file that is not valid YAML and names it, before it changes any MegaLinter setting
    # Chapter: A read-only settings file stops the update
    # Note: The developer has undone what the stopped update wrote, closed the bracket in shared.yml and committed the fix. Then they made shared.yml read-only: stat shows 444 for it, so nobody may write it, and 644 for the four other files, which their owner may write.
    # Note: The clean-up says "No write access to .config/megalinter/shared.yml", then "No settings file was changed". It checks that it may write every file before it writes any, so config.flow.yml and config.yml keep their retired linters for now.
    # Note: git status lists only the two files Copier had already written.
    # Copy: stat -c '%a %n' .config/megalinter/*.yml && task devsecops:update; git status --short
    And the framework update stops at a read-only settings file and names it, before it changes any MegaLinter setting
    # Chapter: Back on what GitLab holds, the update arrives as a clean merge request
    # Note: The developer goes back to what GitLab holds: the reset drops the commits with the link and with shared.yml, and git clean removes the file the stopped update had added. Then they ask for the update again.
    # Note: This time the clean-up prints "removed retired references" for config.flow.yml and for config.yml, and the update ends with "Opened merge request update-framework-devsecops → main."
    # Copy: git reset -q --hard origin/main && git clean -fdq && task devsecops:update
    When the developer goes back to what GitLab holds and asks for the framework update again
    # Note: The Changes tab of that merge request on GitLab, four files. The first two are the release itself, folded here: the version number in the answers file, and the one file this test release adds.
    # Note: In both MegaLinter files, only the lines that name a retired linter go. A comment written at the end of such a line stays, on a line of its own. JSON_V8R, YAML_V8R, FORMATTERS_DISABLE_ERRORS and ERROR_ON_MISSING_EXEC_BIT stay as they were.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1/diffs
    Then the merge request removes only the retired linters and keeps every explanation and control
    # Note: The developer, now on the update branch, asks for the update once more. Copier says "Keeping template version 1.0.1", and the clean-up runs without removing anything.
    # Note: The update ends with "Nothing to commit on update-framework-devsecops.": nothing is pushed, and the merge request stays as it was.
    # Copy: task devsecops:update
    And asking for the update a second time leaves nothing to change

  # A framework update must leave lychee, the link checker, able to read its
  # own settings. A project generated before the toolbox accepted status codes
  # of its own wrote its accept list in the toolbox's lychee file, the only
  # place for it, and the release that adds the toolbox's list merges cleanly
  # and sets accept twice. TOML refuses a key set twice, and lychee then stops
  # before checking a single link. Told in a real terminal, where MegaLinter
  # runs: ONE sentence = ONE card = ONE pixel baseline (tolerance: 0).
  # cspell:ignore lycheeignore -- the file lychee reads its project's own excludes from
  @lychee-settings
  Scenario: a framework update keeps lychee reading its settings, and the project's own addresses stay in a file of their own
    # Note: Off camera, the project was generated from release 23.0.43 of a test toolbox, whose lychee settings, .config/lychee/config.toml, end on the exclude_path list. Its MegaLinter settings run lychee alone, on docs/services.md, so the run stays short.
    # Note: On screen, the developer's commit, "docs: link our local services". At the top of the toolbox's lychee settings, an accept list names the status codes lychee must count as a working link: 200 (OK), 206, 403 (forbidden) and 429 (too many requests). The storage console address goes in .lycheeignore, a file of the project's own. docs/services.md links to that console and to http://127.0.0.2:9/status, where nothing answers.
    # Copy: git show --format=%s
    Given the developer kept their own accepted status codes in the toolbox's lychee settings, and their own address in .lycheeignore
    # Note: Release 24.4.10 of the test toolbox adds its own accept list at the end of the same file. Copier says "Updating to template version 24.4.10" and merges it without a conflict, so the file now sets accept twice, which TOML refuses.
    # Note: Copier then runs the release's migration, merge-lychee-keys.py, which prints "[lychee migration] accept was set twice in .config/lychee/config.toml: merged into one list".
    # Copy: task copier:update TASK_COPIER_CLI_OPTS=--defaults
    When the developer updates the project to the release that adds the toolbox's own accept list
    # Note: What the update changed in the lychee settings. The developer's list leaves the top of the file. At the end, under the toolbox's explanation, one list holds the developer's 200, 206, 403 and 429 and the toolbox's '200..=299'.
    # Note: Just above, the release says where a project's own addresses go from now on: .lycheeignore, a file no update touches.
    # Copy: git diff -- .config/lychee/config.toml
    Then the lychee settings keep one accept list, with the developer's codes and the toolbox's
    # Note: The developer runs MegaLinter and, as it fails, reads lychee's own report. lychee read its settings and checked the two links of docs/services.md: Excluded counts 1, the storage console that .lycheeignore lists, and Errors counts 1.
    # Note: That error is the dead link, http://127.0.0.2:9/status, refused because nothing answers there. lychee checks links again, and the project's own address stays out of the check.
    # Copy: task megalinter > /dev/null 2>&1 || cat megalinter-reports/linters_logs/SPELL_LYCHEE-ERROR.log
    And lychee reads its settings, skips the address in .lycheeignore and reports the dead link

  @megalinter-base-render
  Scenario: a generated project receives the MegaLinter base settings in the shape MegaLinter keeps them
    # Note: A terminal in the toolbox itself. .config/megalinter/config.base.yml holds the MegaLinter settings the toolbox ships to every project, and its first lines say "DO NOT EDIT THIS FILE".
    # Note: sed prints that file from REPOSITORY_DUSTILOCK_ARGUMENTS down to SHOW_ELAPSED_TIME, and cat -n numbers the lines. Line 4 is the one blank line between the two settings.
    # Copy: sed -n '/^REPOSITORY_DUSTILOCK_ARGUMENTS:/,/^SHOW_ELAPSED_TIME:/p' .config/megalinter/config.base.yml | cat -n
    Given the toolbox's own MegaLinter base settings keep one blank line before SHOW_ELAPSED_TIME
    # Note: The same command in a project the test has just generated from the toolbox, with every default answer. The same five lines, with the one blank line at line 4.
    # Note: Prettier, the YAML formatter MegaLinter runs, never leaves two blank lines in a row, and these settings ask MegaLinter to apply its fixes. A second blank line here made `task code` rewrite a file that says "DO NOT EDIT".
    # Note: The test also checks that these lines are the toolbox's byte for byte, and that the whole file never has two blank lines in a row.
    # Copy: sed -n '/^REPOSITORY_DUSTILOCK_ARGUMENTS:/,/^SHOW_ELAPSED_TIME:/p' .config/megalinter/config.base.yml | cat -n
    Then a freshly generated project gets the same lines, with the same single blank line

  # DevSkim, the security scanner MegaLinter runs over the whole repository,
  # skips the folders its settings list, and it matches them against the full
  # path of each file. The tmp entry was meant for a project's own tmp folder,
  # but on a developer's machine MegaLinter mounts the project under /tmp/lint:
  # the whole project matched, and task megalinter passed where CI failed
  # (issue #239). The terminal runs the real task megalinter with DevSkim alone.
  @devskim-workspace
  Scenario: DevSkim flags an insecure address on a developer's machine as in CI, and still skips the project's tmp folder
    # Note: A project generated from the toolbox holds the same line twice: src/fetch.js reads its data from an http:// address, and tmp/scratch.js, a scratch file in the project's own tmp folder, is a copy of it.
    # Note: Below them, DevSkim's settings: the folders it skips. The tmp entry, **/?*/tmp/**, wants a folder name before tmp: it matches the project's own tmp folder, never a tmp folder the project sits in.
    # Copy: head -n 1 src/fetch.js tmp/scratch.js && cat .config/devskim/config.json
    Given a generated project holds an http:// address in its source and a copy in its own tmp folder
    # Note: The developer runs MegaLinter with DevSkim alone, then reads the findings back from the report that run wrote. MegaLinter mounts the project under /tmp/lint, a path that starts with tmp.
    # Note: The finding fails the run, so task ends on "exit code 201", as the same scan does in CI. The report holds one finding: DS137138, an insecure URL, in src/fetch.js, and nothing in tmp/scratch.js. The test also scans the same files where CI puts them, under /builds: DevSkim flags the same file there.
    # Copy: task megalinter > /dev/null 2>&1; echo "exit code $?"; jq -r '.runs[].results[] | .ruleId + " " + .locations[0].physicalLocation.artifactLocation.uri' megalinter-reports/megalinter-report.sarif
    Then on the developer's machine DevSkim flags the address in the source and skips the copy in tmp
