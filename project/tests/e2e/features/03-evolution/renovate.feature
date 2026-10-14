@e2e
Feature: Dependency updates flow through the framework, not around it
  As a maintainer of the DevSecOps Toolbox and of every project it generates
  I want a generated project to receive its tool updates inside the toolbox
  update only, and the toolbox to update each of its own tools on its own
  So that a project never fights the framework over a tool version, and one
  broken dependency never holds the others back

  # Renovate is the bot that opens dependency-update merge requests. The story
  # runs the real bot twice against the test GitLab, the way the scheduled job
  # runs it: first on a generated project, then on the toolbox itself. Every
  # card is the GitLab page a maintainer opens, and every card is twinned with
  # the bot's own log and the GitLab API, so a regression fails loud even
  # without eyes. Both projects run no CI and their main branch accepts no
  # merge, so what Renovate opened stays open for the cards.
  @renovate-flow
  Scenario: A generated project gets its tool updates inside the toolbox update, and the toolbox updates each tool on its own
    # Chapter: A generated project only receives the toolbox update
    # Note: Off camera, the test GitLab holds a copy of the toolbox with two releases. Release 1.0.0 pins node 22.0.0 and glab 1.40.0, and release 1.0.1 moves them to 22.1.0 and 1.41.0. Next to it sits a project generated from release 1.0.0, whose developer added one dependency of their own: toml 0.10.0 in project/requirements.txt.
    # Note: Renovate runs on that project. GitLab's list of open merge requests shows two of them, "update dependency toml to v0.10.2" and "update devsecops toolbox to v1.0.1", and neither carries a red failed check. There is none for node or glab, although the project still pins them old: those tools belong to the toolbox.
    # Copy: task renovate TASK_RENOVATE_PLATFORM=gitlab
    When Renovate runs on a project generated from an older toolbox release, it opens only the toolbox update and the project's own update
    # Note: The Changes tab of the toolbox update. Renovate ran the toolbox's own update command for it, from the project root and without a shell. The merge request holds what that command changed: the answers file now names release 1.0.1, and node and glab move to the pins release 1.0.1 carries.
    # Note: No .config/devsecops/VERSION is among the files. That stray file is what Renovate's own Copier run used to leave, working from the folder of the answers file.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/<iid>/diffs
    Then the toolbox update brings the newer tool pins with it, and no stray VERSION file
    # Chapter: The toolbox updates its own tools, one merge request each
    # Note: Off camera, the toolbox's main branch gets one more commit after both releases. It pins five dependencies back to old versions: copier and ansible-core from Python, playwright from npm, the Playwright test image from the Microsoft registry, and MegaLinter, whose number is a Docker tag.
    # Note: Renovate runs on the toolbox itself. For the test, a setting limits it to these five and holds each one to a single newer release, so the picture never moves. GitLab lists five merge requests, one per dependency: when twenty updates ride in one merge request, one broken package holds the nineteen others back.
    # Note: The playwright package and its test image come in two merge requests, because npm publishes first and the image follows days later. That is why the test image installs the browser its own playwright asks for.
    # Copy: task renovate TASK_RENOVATE_PLATFORM=gitlab
    When the toolbox's own Renovate runs, it opens one merge request per dependency
    # Note: The Changes tab of the copier update. copier is pinned in two places: .config/copier/requirements.txt, and install.sh, which installs copier before the toolbox is on the machine. Both move from 9.0.1 to 9.1.0 in this one merge request.
    # Note: Before the pin-back, the test checks that every install.sh pin equals its .config source, for task, copier, gum and glow.
    # Copy: http://gitlab/<lambda-user>/<toolbox>/-/merge_requests/<iid>/diffs
    Then the copier update moves its config pin and its installer pin together
    # Note: The Changes tab of the MegaLinter update. The local runner in .config/megalinter/package.json and the image of both CI templates move from 9.1.0 to 9.5.0 together, so a local run and the pipeline never lint with two versions.
    # Note: 9.5.0 only exists on ghcr.io, because Docker Hub stopped at 9.4.0. Renovate reads the registry that still publishes.
    # Copy: http://gitlab/<lambda-user>/<toolbox>/-/merge_requests/<iid>/diffs
    And the MegaLinter update moves the local pin and both CI pins together

  @renovate-runtime
  Scenario: Renovate validates through its pinned download without a global installation
    # Note: One terminal session in a freshly generated project, on a machine with no Renovate installed. The developer writes an option Renovate does not know into the configuration.
    # Note: task renovate:validate downloads the Renovate release the project pins through npx. It answers "Invalid configuration option: unknownOptionForTest" and fails. Once git puts the generated configuration back, the same task answers "Config validated successfully against 1 file(s)".
    # Copy: task renovate:validate
    Then a project without Renovate installed gets the pinned validator, which refuses an unknown option and accepts the generated configuration
