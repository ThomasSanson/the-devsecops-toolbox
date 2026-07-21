@e2e
Feature: An everyday change goes from an issue to a released version
  As a developer working on a project the toolbox already set up
  I want to open an issue, carry the change through a merge request, and see
  main release it on its own
  So that the daily contribution loop is proven end to end, from ticket to tag.

  # ONE story, its own shard: a project that already ran the installer gets one
  # small everyday change, done exactly the way a human developer does it — the
  # issue first, the merge request created from it and self-assigned, a fresh
  # clone in a workspace folder, one README line, a conventional feat commit,
  # the merge request pipeline, the merge, and main's own pipeline stamping the
  # next version with no manual release. The developer stays signed in on every
  # GitLab page, and ends by deleting the local clone: nothing survives but
  # what GitLab holds, ready for a clean start next time. ONE Gherkin sentence
  # = ONE card = ONE pixel baseline, asserted inside the step (tolerance: 0);
  # every card twins its frame with a REST/git check of the same fact. A
  # project-scoped runner runs the real pipelines; it is registered and torn
  # down for this story alone.
  #
  # Chapter 1 opens the work as an issue and a merge request created from it.
  # Chapter 2 clones fresh, carries the change on its branch and turns the
  # merge request green. Chapter 3 merges into main, watches the release run,
  # and checks what it left behind.
  @daily-contribution
  Scenario: An issue becomes a merge request, and main releases the change
    # Chapter: An issue starts the work
    # Note: A project that already ran the installer: main carries the whole framework, with its automation tokens wired so the release can run on its own. The developer is signed in — this is where a new day of work begins.
    # Copy: http://gitlab/<lambda-user>/<project>
    Given an installed project with the framework already on its main branch
    # Note: An issue is a ticket describing the work. This one asks for a short line in the README. Opening it first is how a change starts here — and the issue page already offers the next move: the "Create merge request" button.
    # Copy: http://gitlab/<lambda-user>/<project>/-/issues/1
    When the developer opens an issue for a small change
    # Note: The merge request is created straight from the issue — GitLab names its branch after the ticket and links the two — and the developer takes the work by assigning the merge request to themself.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    And the developer creates the merge request from the issue and takes it
    # Chapter: The change rides a merge request
    # Note: The developer starts from a clean slate, the way real work starts: a workspace folder named after the project's address, a fresh clone inside it, and the issue's branch checked out.
    # Copy: git clone http://gitlab/<lambda-user>/<project>.git .
    When the developer clones the project into a fresh workspace folder
    # Note: The change itself: one line added at the end of the README. This is the everyday edit the whole story is about.
    # Copy: echo "This project was scaffolded with The DevSecOps Toolbox." >> README.md
    And the developer adds the line to the README
    # Note: The commit message follows Conventional Commits (feat: a new feature) — the release tooling reads it later to pick the next version. The card shows the commit command and git's own answer.
    # Copy: git commit -m "feat: mention the toolbox in the readme"
    And the developer commits the change as a conventional feat
    # Note: Pushing the branch updates the merge request and starts its pipeline (the automatic checks that must pass before the change can merge).
    # Copy: git push
    And the developer pushes the branch to GitLab
    # Note: The full inherited pipeline runs on the change and every job passes: the merge request now says so, and the merge button is unlocked. Main only accepts a change once these checks are green.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    Then the merge request's pipeline turns green
    # Chapter: Main releases it
    # Note: With the pipeline green, the merge request is merged. The branch joins main through review, never a forced push, and the issue closes itself.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    When the reviewed change merges into main
    # Note: The project's home page right after the merge: the feat commit sits on top of main and the README now ends with the developer's line.
    # Copy: http://gitlab/<lambda-user>/<project>
    Then the project home now shows the change on main
    # Note: The merge started main's own pipeline, with the release stage in it — no one asked for a release, the pipeline just includes it. It ran green from start to finish.
    # Copy: http://gitlab/<lambda-user>/<project>/-/pipelines?ref=main
    And main's own pipeline runs the release
    # Note: Inside the release job's log: Commitizen reads the feat commit, moves the version from 0.1.0 to 0.2.0 and stamps the tag. These are the job's own lines.
    # Copy: http://gitlab/<lambda-user>/<project>/-/pipelines?ref=main
    And the release job's own log confirms the version move
    # Note: The tags page now shows 0.2.0 — plain, with no v in front — carrying the release commit.
    # Copy: http://gitlab/<lambda-user>/<project>/-/tags
    And GitLab's tags page now shows 0.2.0
    # Note: The release is also visible in the files: main's tree now opens on the bump commit, with the README carrying the developer's line.
    # Copy: http://gitlab/<lambda-user>/<project>
    And the project files on main now carry the release
    # Note: The proof in the files themselves: VERSION reads 0.2.0, and the release commit touched exactly the two files that track the version — VERSION and the Commitizen config inside .config.
    # Copy: git show origin/main:VERSION
    And VERSION and the version config really moved to 0.2.0
    # Note: Work done, the developer deletes the local clone. Nothing is lost — GitLab holds the branch, the merge, the tag — and the next change will start from a fresh clone, exactly like this one did.
    # Copy: rm -rf ~/workspace/gitlab/<lambda-user>/<project>
    And the developer removes the local clone, ready to start clean next time
