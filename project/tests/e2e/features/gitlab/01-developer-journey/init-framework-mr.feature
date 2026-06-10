@e2e @e2e-journey @e2e-init-framework-mr
Feature: Developer journey — init delivers the framework via an init-framework-devsecops merge request
  As a developer onboarding the DevSecOps Toolbox
  I want `task devsecops:init` to bootstrap main (if needed) and open a reviewable
  init-framework-devsecops merge request, then configure the GitLab project
  So that the framework is introduced via a merge request, never pushed straight to main

  # Case A — the blank repo (no commits): init bootstraps main with a minimal
  # README, then opens the framework MR.
  @e2e-init-framework-mr-blank
  Scenario: init bootstraps main and opens the framework merge request on a blank repo
    Given a GitLab runs in a container configured with user "lambda"
    And a fresh Ubuntu web terminal cloned from a freshly created blank GitLab project
    And the working-branch installer is staged in the terminal
    And glab is authenticated against the test GitLab

    # GitLab — the blank repository as the developer sees it before installing
    Then the empty project page should visually match "gitlab/01-developer-journey/gitlab-empty-project"

    When I run the working-branch installer to completion
    Then the install log should contain "Bootstrapping main"
    And the install log should contain "init-framework-devsecops"
    And the install log should contain "Opened merge request"
    And the install log should contain "Installation complete!"

    # Terminal proof — the installer completion screen (real terminal)
    Then the terminal from "Installation complete!" should visually match "gitlab/01-developer-journey/installation-complete-terminal"

    # GitLab-side — main bootstrapped + framework delivered via a reviewable MR
    And the project should have a branch "main"
    And the project should have a branch "init-framework-devsecops"
    And a merge request from "init-framework-devsecops" into "main" should be open for the project
    And the merge request page should visually match "gitlab/01-developer-journey/init-framework-merge-request-page"
    And the merge request should report changed files

    # GitLab — main bootstrapped (README rendered) + the two branches
    And the project home page should visually match "gitlab/01-developer-journey/gitlab-main-readme"
    And the branches page should visually match "gitlab/01-developer-journey/gitlab-branches"

    # GitLab project configuration applied during init (REST)
    And a project access token "TASK_COMMITIZEN_TOKEN" must exist with Maintainer role for the journey project
    And the branch "main" must be protected with merge for maintainers and push for no one for the journey project

    # GitLab configuration pages (logged in as lambda) — what init configured
    When I am logged in to GitLab as lambda
    Then the access tokens page should visually match "gitlab/01-developer-journey/gitlab-access-tokens"
    And the CI/CD variables page should visually match "gitlab/01-developer-journey/gitlab-cicd-variables"
    And the merge request settings page should visually match "gitlab/01-developer-journey/gitlab-merge-settings"
    And the protected branches page should visually match "gitlab/01-developer-journey/gitlab-protected-branch"

    # Stage 5 — the reviewer merges the framework MR; main now carries the
    # framework. The pipeline gate is lifted because the test GitLab has no CI
    # runner (a pipeline can never succeed here); the ff merge against the
    # init-applied branch protection is what this stage proves.
    Given the merge gate on pipelines is lifted for the journey project
    When the merge request is merged as lambda
    Then the merge request should be merged
    And the merged merge request page should visually match "gitlab/01-developer-journey/init-framework-merge-request-merged"
    And the branch "main" must contain the file "Taskfile.yml" for the journey project
    And the branch "main" must contain the file ".gitlab-ci.yml" for the journey project
    And the project home page should visually match "gitlab/01-developer-journey/gitlab-main-post-merge"

  # Case B — main already exists and we are ON main: init still branches from
  # main into init-framework-devsecops and opens the MR.
  @e2e-init-framework-mr-existing-main
  Scenario: init opens the framework MR when main already exists and we are on main
    Given a GitLab runs in a container configured with user "lambda"
    And a fresh Ubuntu web terminal cloned from a GitLab project that already has a main branch
    And the working-branch installer is staged in the terminal
    And glab is authenticated against the test GitLab

    When I run the working-branch installer to completion
    Then the install log should contain "init-framework-devsecops"
    And the install log should contain "Installation complete!"
    And the project should have a branch "init-framework-devsecops"
    And a merge request from "init-framework-devsecops" into "main" should be open for the project

    # Visual proofs — per-variant baselines (parallel workers must never share
    # an actual capture path); the branches page shows the pre-existing main.
    And the terminal from "Installation complete!" should visually match "gitlab/01-developer-journey/installation-complete-existing-main-terminal"
    And the merge request page should visually match "gitlab/01-developer-journey/init-framework-merge-request-page-existing-main"
    And the branches page should visually match "gitlab/01-developer-journey/gitlab-branches-existing-main"

  # Case C — main exists but we are on another branch: init must branch from
  # main (not the current branch) into init-framework-devsecops.
  @e2e-init-framework-mr-other-branch
  Scenario: init branches from main even when run from another branch
    Given a GitLab runs in a container configured with user "lambda"
    And a fresh Ubuntu web terminal cloned from a GitLab project that already has a main branch
    And the terminal is checked out on a feature branch "spike/poc"
    And the working-branch installer is staged in the terminal
    And glab is authenticated against the test GitLab

    When I run the working-branch installer to completion
    Then the install log should contain "init-framework-devsecops"
    And a merge request from "init-framework-devsecops" into "main" should be open for the project

    # Visual proofs — the local feature branch is never pushed, so GitLab shows
    # main + init-framework-devsecops only; the MR page proves the branch was
    # cut from main (not from spike/poc).
    And the terminal from "Installation complete!" should visually match "gitlab/01-developer-journey/installation-complete-other-branch-terminal"
    And the merge request page should visually match "gitlab/01-developer-journey/init-framework-merge-request-page-other-branch"
    And the branches page should visually match "gitlab/01-developer-journey/gitlab-branches-other-branch"

  # Disable flag — TASK_DEVSECOPS_INIT_DIRECT=true skips the merge-request
  # delivery entirely: NO init-framework-devsecops branch, NO merge request.
  # The scaffolded framework stays in the LOCAL working tree (the protected
  # main forbids direct pushes anyway); only the bootstrap README reaches main.
  @e2e-init-framework-mr-direct
  Scenario: TASK_DEVSECOPS_INIT_DIRECT skips the merge-request delivery and leaves the framework local
    Given a GitLab runs in a container configured with user "lambda"
    And a fresh Ubuntu web terminal cloned from a freshly created blank GitLab project
    And the working-branch installer is staged in direct mode in the terminal
    And glab is authenticated against the test GitLab

    When I run the working-branch installer to completion
    Then the install log should contain "Installation complete!"
    And the project should have a branch "main"
    And the project should not have a branch "init-framework-devsecops"
    And no merge request should be open for the project

    # Visual proofs — direct mode: a single main branch carrying ONLY the
    # bootstrap README; the framework stays in the local working tree.
    And the terminal from "Installation complete!" should visually match "gitlab/01-developer-journey/installation-complete-direct-terminal"
    And the branches page should visually match "gitlab/01-developer-journey/gitlab-branches-direct"
    And the project home page should visually match "gitlab/01-developer-journey/gitlab-main-direct"
