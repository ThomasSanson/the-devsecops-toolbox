@e2e
Feature: Dependency updates flow through the framework, not around it
  As a maintainer of the DevSecOps Toolbox and of every project it generates
  I want a generated project to receive its tool updates inside the toolbox
  update only and its own minor and patch updates in one merge request, and
  the toolbox to bring its own small updates in one merge request too, apart
  from the tools that change what its tests see
  So that a project never fights the framework over a tool version, and
  neither pays one pipeline nor one night per small update

  # Renovate is the bot that opens dependency-update merge requests. The story
  # runs the real bot three times against the test GitLab, the way the
  # scheduled job runs it: twice on a generated project, then on the toolbox
  # itself. Every card is the GitLab page a maintainer opens, and every card
  # is twinned with the bot's own log and the GitLab API, so a regression
  # fails loud even without eyes. Both projects run no CI and their main
  # branch accepts no merge, so what Renovate opened stays open for the cards.
  @renovate-flow
  Scenario: A generated project gets its tool updates inside the toolbox update, and the toolbox groups its own small updates
    # Chapter: A generated project only receives the toolbox update
    # Note: Off camera, the test GitLab holds a copy of the toolbox with two releases. Release 1.0.0 pins node 22.0.0 and glab 1.40.0, and release 1.0.1 moves them to 22.1.0 and 1.41.0. Next to it sits a project generated from release 1.0.0, whose developer added one dependency of their own: toml 0.10.0 in project/requirements.txt.
    # Note: The project also deploys its own image. GitLab shows project/kustomize/overlays/staging/kustomization.yaml, the file that says which version runs in staging: it pins that image at 0.2.0. The project's registry already holds 0.2.1. For the test, that registry is a small stand-in at localhost:5050 that knows these two versions.
    # Copy: http://gitlab/<lambda-user>/<project>/-/blob/main/project/kustomize/overlays/staging/kustomization.yaml
    Given the project deploys its own image, pinned at 0.2.0 in its staging manifest
    # Note: Renovate runs on that project. GitLab's list of open merge requests shows two of them, "update dependency toml to v0.10.2" and "update devsecops toolbox to v1.0.1", and neither carries a red failed check. There is none for node or glab, although the project still pins them old: those tools belong to the toolbox.
    # Note: There is none for the project's own image either, and Renovate never asks the registry about it. A Renovate bump of that image was a fix commit, so it made a release, the release published a new image, and Renovate bumped it again, in a loop. A version reaches staging through a merge request a person opens.
    # Copy: task renovate TASK_RENOVATE_PLATFORM=gitlab
    When Renovate runs on a project generated from an older toolbox release, it opens only the toolbox update and the toml update
    # Note: The Changes tab of the toolbox update. Renovate ran the toolbox's own update command for it, from the project root and without a shell. The merge request holds what that command changed: the answers file now names release 1.0.1, and node and glab move to the pins release 1.0.1 carries.
    # Note: No .config/devsecops/VERSION is among the files. That stray file is what Renovate's own Copier run used to leave, working from the folder of the answers file.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/<iid>/diffs
    Then the toolbox update brings the newer tool pins with it, and no stray VERSION file
    # Chapter: A generated project's own minor and patch updates share one merge request
    # Note: Off camera, the developer pushes one more commit to the main branch of the same project. GitLab shows project/requirements.txt: toml is still pinned at 0.10.0, and two dependencies joined it.
    # Note: nose 1.2.1 has a minor update waiting, to 1.3.7. oauth2client 3.0.0 has a major update waiting, to 4.1.3. A major update is the kind that can break the code.
    # Copy: http://gitlab/<lambda-user>/<project>/-/blob/main/project/requirements.txt
    Given the developer adds nose 1.2.1 and oauth2client 3.0.0 to the project's own dependencies
    # Note: Renovate runs on the project a second time. GitLab's list of open merge requests shows three: "update dependency oauth2client to v4", "update project dependencies", which holds toml and nose, and "update devsecops toolbox to v1.0.1". The toml merge request of the first run, !1, became the project dependencies one.
    # Note: The main branch only takes a merge request that sits right on top of it, so each merge makes Renovate rebase every other open one, and each rebase runs a full pipeline again. On a real project, ten merge requests cost ten pipelines of twenty jobs for a single merge. Minor and patch updates rarely break anything, so they ride together. A major update can, so it still comes alone, like the toolbox update.
    # Copy: task renovate TASK_RENOVATE_PLATFORM=gitlab
    When Renovate runs on the project again, the minor and patch updates of toml and nose share one merge request, and the major update of oauth2client gets its own
    # Note: The Changes tab of the project dependencies merge request, opened from the branch renovate/project-dependencies. In project/requirements.txt, toml moves from 0.10.0 to 0.10.2 and nose from 1.2.1 to 1.3.7, in one change.
    # Note: The oauth2client line does not move here. Its own merge request takes it to 4.1.3.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/<iid>/diffs
    Then the project dependencies merge request moves toml and nose together, and leaves oauth2client to its own merge request
    # Chapter: The toolbox groups its own small updates, and keeps the tools its tests see apart
    # Note: Off camera, the toolbox's main branch gets one more commit after both releases. It pins five dependencies back to old versions: copier and ansible-core from Python, playwright from npm, the Playwright test image from the Microsoft registry, and MegaLinter, whose number is a Docker tag.
    # Note: Renovate runs on the toolbox itself. For the test, a setting limits it to these five and holds each one to a single newer release, so the picture never moves. GitLab lists three merge requests. copier, ansible-core and MegaLinter share one, "update toolbox dependencies": Renovate runs once a night and the main branch takes one merge at a time, so five merge requests would take five nights.
    # Note: playwright and its test image keep a merge request each, like gitlab-ce, gitlab-runner, codeceptjs-visual-helper, python and lizard, because they change what the tests see. They come apart because npm publishes first and the image follows days later. That is why the test image installs the browser its own playwright asks for.
    # Copy: task renovate TASK_RENOVATE_PLATFORM=gitlab
    When the toolbox's own Renovate runs, it groups its small updates and keeps playwright apart
    # Note: The Changes tab of the grouped merge request, on install.sh. copier is pinned in two places: .config/copier/requirements.txt, and install.sh, which installs copier before the toolbox is on the machine. Both move from 9.0.1 to 9.1.0 in this merge request.
    # Note: Before the pin-back, the test checks that every install.sh pin equals its .config source, for task, copier, gum and glow.
    # Copy: http://gitlab/<lambda-user>/<toolbox>/-/merge_requests/<iid>/diffs
    Then the copier update moves its config pin and its installer pin together
    # Note: Further down the same merge request, the MegaLinter image of the CI template moves from 9.1.0 to 9.5.0. The Files panel shows the two other places it is pinned changing with it, code.yml.jinja and the local runner in .config/megalinter/package.json, so a local run and the pipeline never lint with two versions.
    # Note: 9.5.0 only exists on ghcr.io, because Docker Hub stopped at 9.4.0. Renovate reads the registry that still publishes.
    # Copy: http://gitlab/<lambda-user>/<toolbox>/-/merge_requests/<iid>/diffs
    And the MegaLinter update moves the local pin and both CI pins together

  @renovate-runtime
  Scenario: Renovate validates through its pinned download without a global installation
    # Note: One terminal session in a freshly generated project, on a machine with no Renovate installed. The developer writes an option Renovate does not know into the configuration.
    # Note: task renovate:validate downloads the Renovate release the project pins through npx. It answers "Invalid configuration option: unknownOptionForTest" and fails. Once git puts the generated configuration back, the same task answers "Config validated successfully against 1 file(s)".
    # Copy: task renovate:validate
    Then a project without Renovate installed gets the pinned validator, which refuses an unknown option and accepts the generated configuration

  @renovate-nightly
  Scenario: On the main branch, a push pipeline leaves Renovate to the project's nightly schedule
    # Note: Every Renovate run on the main branch rebases every open Renovate merge request, and every rebase starts a full pipeline. With fast-forward merges, each merge on main used to restart them all.
    # Note: Off camera, a project on GitLab with a nightly pipeline schedule, like the toolbox's own "Renovate" schedule at 1 am.
    Given a project on GitLab with a nightly pipeline schedule
    # Note: The terminal plays the feedback job of a push pipeline on that project's main branch. The job finds the schedule and leaves Renovate to it, without starting Renovate.
    # Note: Off camera, the same job in the scheduled pipeline runs Renovate. Once the schedule is deleted, a push pipeline runs Renovate again, so a project without a schedule keeps getting its updates.
    # Copy: CI_PIPELINE_SOURCE=push task devsecops:feedback:renovate
    Then a push pipeline leaves Renovate to the schedule, and only the scheduled pipeline runs it
