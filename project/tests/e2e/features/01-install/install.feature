@e2e
Feature: The whole install, from an empty project to a locked-down GitLab
  As a developer adopting the DevSecOps Toolbox
  I want to run the installer, answer its questions, and see the framework land
  through a review with GitLab safely configured
  So that one story proves the entire first install, end to end

  # The flagship story: ONE interactive install in a real terminal (ttyd) builds
  # ONE project, and every GitLab proof below is read from THAT same project.
  # ONE Gherkin sentence = ONE card = ONE pixel baseline, asserted inside the
  # step (tolerance: 0); each terminal card is anchored on the typed command, and
  # each GitLab card twins its masked page with a REST check of the same fact, so
  # a regression fails loud even without eyes. Set up off-camera: the test user,
  # the blank cloned project, the staged working-branch installer, the tools it
  # needs, and the GitLab login. A merge request is the page where changes get
  # reviewed before joining main.
  #
  # Chapter 1 walks the whole Copier questionnaire, one card per question, to the
  # finished screen and the scaffolded project. Chapter 2 shows how the framework
  # arrives — as a merge request from init-framework-devsecops into main, never a
  # forced push. Chapter 3 shows the GitLab project init locked and wired:
  # fast-forward-only merges, no direct pushes to main, the automation token, and
  # that token saved as a CI/CD variable.
  @install-complete
  Scenario: One interactive install builds the framework and configures GitLab
    # Chapter: Answer the questions, build the framework
    # Note: The brand-new project on GitLab: completely empty, nothing pushed yet. Set up off-screen: the test user, the installer, the tools it needs, and the GitLab login.
    # Copy: http://gitlab/<lambda-user>/<project>
    Given a brand-new empty project waits on GitLab
    # Note: The same project freshly cloned in the terminal: git shows nothing saved yet.
    # Copy: git status
    And the developer has just cloned it into the terminal
    # Note: The installer opens with its first question — install the complete framework? — with the typed command still visible above it.
    # Copy: bash /tmp/devsecops-install.sh
    When the developer starts the toolbox installer
    # Note: Saying yes to the complete framework starts the setup questions from Copier (the tool that builds the project from your answers); the first — does the project need Ansible? — defaults to no.
    # Copy: y
    And the developer keeps the complete framework and the first question asks about Ansible
    # Note: The next question asks which CI/CD platform to use — the automatic build-and-deploy system that runs on every change; the developer keeps the default, GitLab.
    And the developer keeps GitLab as the CI/CD platform
    # Note: The next question asks which tool runs the containers; the developer keeps the default, Docker.
    And the developer keeps Docker as the container runtime
    # Note: With Docker chosen, the setup offers to create project/docker-compose.yml; the developer keeps the default, yes.
    And the developer keeps the generated docker-compose file
    # Note: The next question turns the project workspace on or off (it adds project/Taskfile.yml and docker-compose.yml); the developer keeps it on.
    And the developer keeps the project workspace enabled
    # Note: The next question is for projects that must live in a private repository and publish their source all the same; it defaults to no, because a project that is already public has nothing to publish anywhere else.
    And the developer leaves source publication switched off
    # Note: The next question asks whether Renovate — the bot that proposes dependency updates — should merge toolbox updates on its own; the developer keeps it on.
    And the developer keeps Renovate auto-merge enabled
    # Note: The last question sets the language for the test descriptions; the developer keeps the default, en.
    And the developer keeps English as the Gherkin language
    # Note: Answering the last question builds the framework and runs the setup all the way to the finished screen.
    Then the installer builds the project and shows the finished screen
    # Note: The project folder the questions produced: Taskfile.yml, .config, .gitlab-ci.yml, .agent and more.
    # Copy: ls -A1p --color=never
    And the project folder now holds the full DevSecOps framework
    # Chapter: The framework arrives as a merge request
    # Note: The merge request from init-framework-devsecops into main, open and ready for review. The framework never lands on main without this step.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    Then a merge request into main is now waiting for review on GitLab
    # Note: GitLab's branches page: main, with the framework branch beside it.
    # Copy: http://gitlab/<lambda-user>/<project>/-/branches
    And GitLab now lists main and the new init-framework-devsecops branch
    # Chapter: GitLab is locked and wired
    # Note: Main only accepts fast-forward merges, and further down the page a change must pass its pipeline before it can merge — so history stays a straight line and nothing broken reaches main.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/merge_requests
    Then GitLab now lets main accept only fast-forward merges
    # Note: On the protected-branches page: maintainers may merge, but no one may push straight to main. Every change has to go through a review.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/repository
    And GitLab now refuses pushes straight to main
    # Note: On the access-tokens page: the two project tokens the install created — TASK_COMMITIZEN_TOKEN (Maintainer role, used by the release) and TASK_RENOVATE_TOKEN (used by the update bot).
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/access_tokens
    And GitLab now holds an automation token for the project
    # Note: On the CI/CD variables page: the same token, saved as TASK_COMMITIZEN_TOKEN so the pipeline can read it.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/ci_cd
    And GitLab now keeps that token as a CI/CD variable
    # Chapter: The merge request proves itself
    # Note: The framework merge request, now merged: the green Merged badge, the pipeline that passed all 17 jobs, and the branch joined into main. A project-scoped runner (the machine that runs the pipeline) ran the checks; the merge only happened once they were green — reached through review, never a forced push.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    Then the framework pipeline passes and the merge request merges into main
    # Note: GitLab's file tree for main now holds the whole framework — Taskfile.yml, .gitlab-ci.yml, .config, .agent — and the commit's own pipeline runs green, so main built clean after the merge. The first install is proven end to end.
    # Copy: http://gitlab/<lambda-user>/<project>/-/tree/main
    And main now carries the whole framework, merged through review
