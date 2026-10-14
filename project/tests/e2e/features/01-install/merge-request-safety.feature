@e2e
Feature: init always delivers the framework through a review you can see
  As a developer setting up the DevSecOps Toolbox
  I want init to reach the main branch through a merge request I can review
  So that the framework never lands on the main branch without a review, unless I clearly ask for it

  # ONE story in two chapters, each in its OWN fresh project (they never share
  # state). A merge request is the page where changes get reviewed before they
  # join the main branch. ONE Gherkin sentence = ONE card = ONE pixel baseline,
  # asserted inside the step (tolerance: 0), and every card is paired with a
  # check of the same fact (REST on GitLab, the install log and the clone in the
  # container), so a regression fails loud even without eyes.
  #
  # Chapter 1: the main branch already exists on GitLab, and the developer runs
  # the installer from a local experiment branch that carries a commit of its
  # own. init builds its branch from the main branch, not from where the
  # developer stands, opens the review, and never pushes the experiment. The
  # branches page opens and closes the chapter, before and after. Chapter 2: the
  # opt-out you ask for on purpose (TASK_DEVSECOPS_INIT_DIRECT=true), typed on
  # camera: no branch and no merge request, and only the starter README reaches
  # the main branch.
  @merge-request-safety
  Scenario: init routes through a review from any branch, and steps aside only when you opt out
    # Chapter: The main branch already exists, and the developer is on an experiment branch
    # Note: GitLab's branches page for a project that already has a first commit. The main branch is the only branch, marked "default" and "protected", on its commit "Initial commit".
    # Note: The project's random name shows as "project", and dates and commit codes are hidden, so the picture is the same on every run.
    # Copy: http://gitlab/<lambda-user>/<project>/-/branches
    Given GitLab holds a project whose main branch already has a first commit
    # Note: The developer's terminal, in their copy of the project. One typed line makes a branch called spike/poc, adds a line to the README and commits it as "wip: try an idea", then prints the history.
    # Note: The history shows that commit on spike/poc, where the developer now stands (HEAD), above "Initial commit", where the main branch and its GitLab copy origin/main still are. Commit codes show as <sha>, since they change on every run.
    # Copy: git switch -c spike/poc && echo idea >> README.md && git commit -am "wip: try an idea" && git log --oneline --all
    And the developer's copy is on a local experiment branch with a commit of its own
    # Note: The developer runs the installer from spike/poc and accepts every default. This card is the end of that run. The installer says "Preparing init-framework-devsecops from main...": it builds its own branch from the main branch, not from spike/poc.
    # Note: It pushes that branch to GitLab and opens merge request !1, "chore: initialize devsecops framework", into the main branch, then says "Installation complete!". The line "warning: redirecting" is git saying that GitLab took the push at the same address with ".git/" at the end, nothing more.
    # Copy: curl -fsSL https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/raw/main/.config/devsecops/install.sh -o /tmp/devsecops-install.sh && bash /tmp/devsecops-install.sh
    When the developer runs the installer on the experiment branch, and it builds the framework branch from the main branch
    # Note: The Commits tab of that merge request on GitLab. It asks to merge init-framework-devsecops into main, and it carries exactly one commit, "chore: initialize devsecops framework".
    # Note: The experiment's commit "wip: try an idea" is not in it. The counters of the Pipelines and Changes tabs are hidden: they change with every run and every new framework file.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1/commits
    Then GitLab holds a merge request into the main branch that carries only the framework commit
    # Note: The same branches page as the first card. init-framework-devsecops now stands next to the main branch, one commit ahead of it, with its merge request "!1".
    # Note: The main branch is still on "Initial commit": nobody pushed to it. There is no spike/poc: the experiment never left the developer's machine.
    # Copy: http://gitlab/<lambda-user>/<project>/-/branches
    And GitLab lists the main branch and the framework branch, never the experiment branch
    # Chapter: The review switched off on purpose
    # Note: A second developer, in the copy of a new empty project, types the installer command with TASK_DEVSECOPS_INIT_DIRECT=true in front of it, and a comment saying what it is for. That setting switches the review off: no framework branch and no merge request.
    # Note: The installer starts as usual and asks its first question, "Install the complete DevSecOps framework?". The developer then accepts every default.
    # Copy: curl -fsSL https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/raw/main/.config/devsecops/install.sh -o /tmp/devsecops-install.sh && TASK_DEVSECOPS_INIT_DIRECT=true bash /tmp/devsecops-install.sh
    When another developer starts the installer on a new project with the review switched off
    # Note: GitLab's branches page for that project once the installer is done. The main branch is alone, on "chore: initialize repository", the first commit the installer makes in an empty project.
    # Note: There is no init-framework-devsecops branch and no merge request badge.
    # Copy: http://gitlab/<lambda-user>/<project>/-/branches
    Then GitLab shows the main branch alone, with no review branch and no merge request
    # Note: The repository page of the main branch. The Files panel and the table list one file, README.md, and its text is the name of the project folder, "my-project".
    # Note: None of the framework files the installer wrote reached the main branch.
    # Copy: http://gitlab/<lambda-user>/<project>/-/tree/main
    And the main branch on GitLab holds only the starter README
