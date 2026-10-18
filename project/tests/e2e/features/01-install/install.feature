@e2e
Feature: The whole install, from an empty project to a locked-down GitLab
  As a developer adopting the DevSecOps Toolbox
  I want to run the installer, answer its questions, and see the framework land
  through a review with GitLab safely configured
  So that one story proves the entire first install, end to end

  # The flagship story: ONE interactive install in a real terminal (ttyd) builds
  # ONE project, and every GitLab card below is read from THAT same project.
  # ONE sentence = ONE card = ONE pixel baseline, asserted inside the step
  # (tolerance: 0). GitLab opens and closes the story on the same page, the
  # project's home page, before and after. The terminal in between is one
  # session, typed on camera, and each menu is caught live, before its answer.
  # Every card is paired with a check of the same fact (the screen, the install
  # log, REST on GitLab), so a regression fails loud even without eyes. Set up
  # off camera: the test user, the empty project and its clone, the staged
  # installer, the tools it needs, the GitLab login and, once the merge request
  # exists, a runner for its pipeline.
  #
  # Chapter 1 installs the framework, from the installer's first question to the
  # merge request it opens. Chapter 2 shows the GitLab settings the install
  # locked and wired. Chapter 3 runs the framework's own pipeline on that merge
  # request, merges it, waits for the main branch's own pipeline, and shows the
  # framework on the main branch.
  @install-complete
  Scenario: One interactive install builds the framework and configures GitLab
    # Chapter: Install the framework
    # Note: GitLab's home page of a brand-new project, as its owner sees it. GitLab says "The repository for this project is empty" and lists the commands that push a first commit.
    # Note: The project's random name shows as "project", and dates and avatars are hidden, so the picture is the same on every run.
    # Copy: http://gitlab/<lambda-user>/<project>
    Given a brand-new empty project waits on GitLab
    # Note: The developer's terminal, in the clone of that empty project. Git answers "No commits yet", then the installer starts and asks its first question, "Install the complete DevSecOps framework?".
    # Note: The card lists the two choices, "Complete framework" and "Choose components". The highlighted button, "Install everything", is the default answer and takes the complete framework.
    # Copy: curl -fsSL https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/raw/main/.config/devsecops/install.sh -o /tmp/devsecops-install.sh && git status && bash /tmp/devsecops-install.sh
    When the developer starts the toolbox installer in the freshly cloned project
    # Note: Saying yes to the complete framework opens the ten setup questions of Copier, the tool that builds the project from the answers. The developer presses Enter on each one and keeps its default.
    # Note: The card is caught on the last question, the language of the test descriptions, with its default "en". Above it, the nine answers already given: No to Ansible, GitLab SaaS (gitlab.com), the runner tag saas-linux-medium-amd64, Docker, then Yes, Yes, Yes, No and Yes.
    # Copy: y
    And the developer answers the ten setup questions, keeping every default
    # Note: On the way, the installer sets the project's merge request rules on GitLab. This part scrolled by: "Applying merge request settings...", one line per setting GitLab now holds, such as "merge_method = ff", and "GitLab merge request settings configured".
    # Note: GitLab answers that change with the whole project, its runner registration token included: a secret that lets a machine sign up to run the project's jobs. The test reads that token from GitLab and checks that the whole session never printed it.
    # Note: The test also runs the same step with a merge method GitLab refuses. The step fails on GitLab's own reason, and prints no token either.
    Then the installer prints only the merge request settings it gave GitLab, never the project's runner token
    # Note: The installer builds the framework, pushes it to a new branch, init-framework-devsecops, and opens a merge request into the main branch. This is GitLab's page for it: "chore: initialize devsecops framework", Open.
    # Note: A merge request is a change that waits for review before it joins the main branch. The framework never reaches the main branch any other way.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    Then the installer's merge request into the main branch now waits for review on GitLab
    # Chapter: GitLab is locked and wired
    # Note: The project's merge request settings. "Fast-forward merge" is selected, so the history of the main branch stays a straight line.
    # Note: Under "Merge checks", "Pipelines must succeed" and "All threads must be resolved" are ticked: nothing broken or still under discussion can merge.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/merge_requests
    Then GitLab now lets the main branch accept only fast-forward merges
    # Note: The protected branches settings. On the main branch, "Allowed to merge" is "Maintainers" and "Allowed to push and merge" is "No one": every change has to go through a merge request.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/repository
    And GitLab now refuses pushes straight to the main branch
    # Note: The project access tokens page lists the two tokens the install created: TASK_COMMITIZEN_TOKEN, which the release uses, and TASK_RENOVATE_TOKEN, which the update bot uses. Both have the Maintainer role.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/access_tokens
    And GitLab now holds the project's two automation tokens
    # Note: The project's CI/CD variables hold both tokens under the same names, so the pipeline can read them. GitLab shows their values as dots.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/ci_cd
    And GitLab now keeps both tokens as CI/CD variables
    # Note: The project's pipeline schedules. The install created one, "Renovate", on the main branch, once a night between 2 and 5 am, Paris time. The hour and the minute come from the project's number, so the projects of a group do not all start at once.
    # Note: Pipelines on the main branch now leave Renovate to this schedule, so a merge no longer rebases every open Renovate merge request.
    # Copy: http://gitlab/<lambda-user>/<project>/-/pipeline_schedules
    And GitLab now runs Renovate from a nightly pipeline schedule
    # Chapter: The merge request proves itself
    # Note: A runner, the machine that runs pipelines, now serves this project, and the merge request's pipeline runs every job the framework ships. All of them pass.
    # Note: The card is the log of one of them, the code:megalinter job: MegaLinter's verdict for each of its linters, one line each, every one "successfully". The secret and dependency scanners betterleaks, grype, trivy and trufflehog are among them.
    # Note: The panel on the right says the job and its pipeline Passed, and lists the other code jobs of the pipeline, all green.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs
    Then the framework's first pipeline passes, its MegaLinter job green on every linter, the secret and dependency scanners included
    # Note: The same merge request page as in chapter 1, now Merged. "Merge request pipeline passed" shows its stages, all green, as the "Pipelines must succeed" rule demands, and "Deleted the source branch" closes the review.
    # Note: Below it, "Pipeline passed on main": the merge started the main branch's own pipeline, and its three stages, plan, release and feedback, passed too. With only chores in the history, the release makes no new version, and the job still passes.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    And the merge request merges into the main branch
    # Note: The same home page as the first card. The main branch now holds the whole framework, .agents, .claude, .config, .gitlab-ci.yml and Taskfile.yml among them, on the commit "chore: initialize devsecops framework". Only README.md stays on "chore: initialize repository", the commit the installer made to create the main branch. The green check next to the last commit is the main branch's pipeline, passed.
    # Note: The first install is proven end to end.
    # Copy: http://gitlab/<lambda-user>/<project>
    And the main branch now carries the whole framework, merged through review
