@e2e
Feature: Dependency updates flow through the framework, not around it
  As a maintainer of the DevSecOps Toolbox and of every project it generates
  I want the rendered Renovate config to pass the real validator and to keep
  .config tool updates centralized in the framework, never in downstream projects
  So that a generated project only ever receives the framework-evolution MR,
  while the framework itself stays the single place .config tool bumps land

  # ONE story in two chapters. ONE Gherkin sentence = ONE card = ONE pixel
  # baseline, asserted inside the step (tolerance: 0). Renovate is the tool that
  # opens dependency-update merge requests. Every card twins its frame with the
  # real validator or the real `task renovate:dry-run`, so a regression fails
  # loud even without eyes.
  #
  # Chapter 1 — the centralization contract, both ways: the rendered config is
  # real, valid config (proven by the actual renovate-config-validator, on and
  # off automerge), a downstream project's Renovate IGNORES stale
  # framework-owned .config pins yet TRACKS its own project/** dependency, while
  # the FRAMEWORK repo's Renovate detects that very same .config drift. Chapter 2
  # — both PLACES a bootstrap tool version is pinned (its .config source AND the
  # install.sh bootstrap line) must be seen by Renovate, or one would silently
  # drift on the next release. Chapter 3 — an update must also arrive in a shape
  # the repository can merge: one dependency per merge request, and a Playwright
  # bump that cannot take the test runner's browser away with it.
  @renovate-flow
  Scenario: Renovate centralizes .config updates in the framework and watches every pinned tool at both endpoints
    # Chapter: Updates flow through the framework
    # Note: .config tooling is owned by THIS framework repo, so a generated project must NOT receive per-tool Renovate MRs, only the framework-evolution MR. The image is the rendered config, where a rule re-added for one specific tool would stand out.
    # Copy: cat .config/renovate/config.json
    Given a generated project carries the framework's centralized renovate config
    # Note: renovate-config-validator itself checks the rendered config, doing far more than a plain JSON.parse would.
    # Copy: task renovate:validate
    When the config passes the real renovate validator
    # Note: The automerge-off branch of the template is real, valid config too.
    # Copy: uvx --python 3.14 --from copier==9.14.3 copier copy --defaults --data devsecops_automerge=false /workspace <project> && task renovate:validate
    Then turning automerge off still passes the same validator
    # Note: Copier refuses this template without --trust (it declares tasks). Renovate only adds --trust when the run allows scripts (allowScripts, a self-hosted option, so task renovate exports it) AND the project opts in (ignoreScripts: false on the toolbox rule). allowedCommands is self-hosted too: kept in the project config, Renovate ignored it and the postUpgradeTasks never ran. Seen on a real project: every framework-evolution MR carried a bare "#copier updated" marker, a red renovate/artifacts status and nothing regenerated.
    # Copy: task renovate:dry-run TASK_RENOVATE_DRY_RUN=extract TASK_RENOVATE_LOG_LEVEL=debug
    And a generated project lets Renovate run Copier with --trust
    # Note: Renovate's own Copier run works from the folder of the answers file, not from the project root. It bumps the version line, leaves a stray VERSION file in .config/devsecops/ and regenerates nothing. The post-upgrade command is what throws that away and runs the real update from the root.
    # Note: Renovate runs that command without a shell: the words go straight to the first program. A line chained with && handed "&&" to git as a file name, git refused it, and the release never landed. Seen on a real project, where only the red renovate/artifacts status held the automerge back.
    # Note: Off-camera: a project generated at release 1.0.0 of a test template, left exactly as Renovate's own Copier run leaves it for release 1.0.1, which adds one file, .config/jq/Taskfile.yml. The card runs the command read from that project's Renovate config, through Renovate's own executor, then shows what changed: the answers file now names 1.0.1, the new file is there, the stray VERSION is gone.
    # Copy: task devsecops:code:sync-templates:renovate TASK_COPIER_CLI_OPTS='--skip-answered --defaults --vcs-ref 1.0.1'
    And Renovate's post-upgrade command runs without a shell and brings the new release in
    # Note: Off-camera: a freshly generated project with every framework-owned .config pin downgraded to a stale value. Renovate's own extraction summary then lists no .config file — the downstream project never re-tracks a framework tool.
    # Copy: task renovate:dry-run TASK_RENOVATE_DRY_RUN=extract
    And a downstream project's renovate ignores stale framework-owned .config drift
    # Note: A separate freshly generated project, this time with an outdated base image added under project/: its extraction summary picks up the project/ Dockerfile — project/** is exactly what a generated project is meant to track.
    # Copy: task renovate:dry-run TASK_RENOVATE_DRY_RUN=extract
    And a downstream project's renovate tracks its own outdated project dependency
    # Note: The SAME .config downgrade, run in a throwaway framework checkout instead of a generated project: here renovate MUST detect it — the framework owns .config and tracks its own tool versions. Downstream ignores, the framework evolves them.
    # Copy: task renovate:dry-run TASK_RENOVATE_DRY_RUN=extract
    And the framework repo's own renovate detects that same stale .config drift
    # Chapter: Every pinned tool is watched in both places
    # Note: Off-camera: a full throwaway copy of the framework, git-pristine first. Each bootstrap tool is then pinned OLDER in both its canonical .config source and the install.sh bootstrap pin — the real git diff shows every OLD to regressed move.
    # Copy: git diff
    Given a safe copy of the framework has every bootstrap tool regressed to an older version
    # Note: The framework's real entrypoint runs against the regressed copy; Renovate's own "Dependency extraction complete" summary lists every regex/pip manager hit plus githubDeps.
    # Copy: task renovate:dry-run TASK_RENOVATE_DRY_RUN=extract
    Then Renovate's own extraction log detects every regressed tool
    # Note: The rule made visible: every tracked tool is reported from its canonical .config source AND install.sh, so one Renovate PR touches both files, never only one.
    # Copy: task renovate:dry-run TASK_RENOVATE_DRY_RUN=extract
    And each tool is detected at both its config source and the install.sh pin
    # Note: The local task and both CI templates pin the same MegaLinter release. Renovate must find all three places so a dependency update cannot silently leave CI behind.
    And Renovate tracks the MegaLinter release in both local and CI execution
    # Chapter: One dependency, one merge request
    # Note: Renovate proposes the updates, and it must propose them one at a time. When twenty dependencies ride in the same merge request, one broken package holds the nineteen others hostage and nobody can tell which one broke.
    # Note: Off-camera: another throwaway copy of the framework, where four dependencies are pinned back to old versions on purpose. One comes from npm, one from the Docker registry, one from Python, and one is the linter whose number is spent as a Docker tag.
    # Note: The picture is the framework's own command answering with the branch it would open for each one. Four dependencies, four branch names, none of them shared. Version numbers are masked so the picture only changes when the answer does, and when upstream opens a new major that major travels in a merge request of its own, under the same branch name.
    # Copy: task renovate:dry-run
    Then Renovate gives every dependency a merge request of its own
    # Note: The tests drive a real Chromium browser. It used to come from the base image alone, and that image only ever ships the browsers of one exact Playwright release.
    # Note: Renovate moves the npm package and the image tag apart, because npm publishes first and the image tag follows days later. That gap is what made every scenario die on "Executable doesn't exist".
    # Note: So the image now installs the browser its own Playwright asks for. The picture reads the runner from the inside: the build line that installs it, and the browser file that is really there.
    # Copy: node -e "console.log(require('playwright').chromium.executablePath())"
    And the test runner already holds the browser its own Playwright asks for

  @renovate-runtime
  Scenario: Renovate validates through its pinned download without a global installation
    # Note: The generated project has an invalid option and a pinned Renovate version. The CodeceptJS runner has no global Renovate installation.
    Given a project has an invalid configuration and no installed Renovate
    # Note: The project's actual task downloads the pinned release through npx. Renovate rejects the invalid option.
    When the pinned Renovate download rejects the invalid option
    # Note: Removing the invalid option makes the same task pass. Validation remains mandatory.
    Then correcting the configuration passes the same Renovate task
    # Note: On a machine without an installed tool, both tasks resolve the same framework-pinned Renovate release. The test reads the commands Go Task would execute.
    And the Renovate download fallback uses the framework version for running and validating
