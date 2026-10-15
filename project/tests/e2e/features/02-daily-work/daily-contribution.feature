@e2e
Feature: An everyday change goes from an issue to a released version
  As a developer working on a project the toolbox already set up
  I want to open an issue, carry the change through a merge request, and see
  the main branch release it on its own
  So that the daily contribution loop is proven end to end, from ticket to tag.

  # ONE story, on its own shard: a project that already ran the installer gets
  # one small everyday change, carried the way a developer carries it. The issue
  # comes first, then the merge request created from it and self-assigned, a
  # clone on the issue's branch, a one-line README in a conventional feat
  # commit, the merge request pipeline, the merge, and the main branch's own
  # pipeline cutting the next version with no manual release. The developer is
  # signed in on every GitLab page. ONE Gherkin sentence = ONE card = ONE pixel
  # baseline, asserted inside the step (tolerance: 0), and every card is paired
  # with a REST or terminal check of the same fact. A project-scoped runner runs
  # the real pipelines; it is registered and torn down for this story alone.
  #
  # Chapter 1 opens the work as an issue and a merge request created from it.
  # Chapter 2 writes the change on the issue's branch and shows it on the merge
  # request. Chapter 3 merges it once its pipeline passes, then shows what the
  # release job did: its log, then the release commit and its tag.
  @daily-contribution
  Scenario: An issue becomes a merge request, and the main branch releases the change
    # Chapter: An issue starts the work
    # Note: GitLab's page for the main branch of a project the installer already set up. The table lists the framework's files and folders, among them .agents, .claude/skills, .config, .gitlab-ci.yml, Taskfile.yml and VERSION, all on the commit "chore: scaffold the project from the devsecops toolbox". There is no README.md yet.
    # Note: The project's name shows as "project", and dates and avatars are hidden, so the picture is the same on every run.
    # Copy: http://gitlab/<lambda-user>/<project>/-/tree/main
    Given an installed project with the framework already on its main branch
    # Note: The developer opened issue #1, "Mention the toolbox in the README", then created its merge request the way the issue's "Create merge request" button does: the branch is named after the issue, and the description says "Closes #1".
    # Note: On the right, the developer is the Assignee, and "Work items" lists the issue under "Closing". Nothing is written yet: the tabs read Commits 0 and Changes 0, and GitLab says "Merge request contains no changes".
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    When the developer opens an issue and creates its merge request, assigned to themself
    # Chapter: The change rides a merge request
    # Note: The developer's clone of the project, in a terminal. Three typed lines: switch to the issue's branch, write a README of one line, then add it, commit it as "feat: mention the toolbox in the readme" and push it.
    # Note: Git answers "create mode 100644 README.md", so the file is new, and "Your branch is up to date", so GitLab has the commit. The "feat:" prefix follows Conventional Commits, the format the release reads later to pick the next version.
    # Copy: git switch 1-mention-the-toolbox-in-the-readme && echo "This project was scaffolded with The DevSecOps Toolbox." > README.md && git add README.md && git commit -m "feat: mention the toolbox in the readme" && git push -q && git status
    When the developer writes a one-line README on the issue's branch, commits it as a conventional feat and pushes it
    # Note: The merge request's Changes tab, the page a reviewer reads. The tabs now read Commits 1, Pipelines 1 and Changes 1. The only file is README.md, a new one, and its one line shows in green, as an addition.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1/diffs
    Then the merge request shows that one-line change
    # Chapter: The main branch releases it
    # Note: The same merge request, merged. "Merge request pipeline passed": its nine icons are the nine stages of the pipeline the project inherited, from plan to feedback, and every job in them passed. Then "Merged by Lambda User", "Deleted the source branch." and "Closed #1 (closed)".
    # Note: The last box, "Pipeline passed" on main, is the main branch's own pipeline. The merge moved the main branch to the developer's commit, and that pipeline ran on it.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    When the merge request's pipeline passes and the developer merges it into the main branch
    # Note: The release job of that pipeline on the main branch, on its own page. In its log, Commitizen reads the feat commit: "increment detected: MINOR", "build: bump version 0.1.0 → 0.2.0", "tag to create: 0.2.0".
    # Note: The job then opens push access for a moment, pushes the tag ("[new tag] 0.2.0 -> 0.2.0") and the version commit, locks the main branch again ("push=No one") and ends on "Job succeeded". Nobody asked for a release: every pipeline of the main branch includes this job.
    # Copy: http://gitlab/<lambda-user>/<project>/-/pipelines?ref=main
    Then the release job on the main branch moves the version from 0.1.0 to 0.2.0
    # Note: GitLab's page for the release commit, "build: bump version 0.1.0 → 0.2.0", the newest on the main branch. The row "Tags" shows 0.2.0, plain, with no "v" in front.
    # Note: The commit changes three files. The Commitizen config .config/commitizen/cz.yaml records version 0.2.0 (Commitizen rewrites the whole file as it saves it, so two other lines change too). CHANGELOG.md gains a 0.2.0 entry listing "mention the toolbox in the readme", its date hidden so the picture is the same on every run. VERSION goes from 0.1.0 to 0.2.0.
    # Copy: http://gitlab/<lambda-user>/<project>/-/commits/main
    And the release commit is tagged 0.2.0 and moves VERSION, the Commitizen config and the CHANGELOG to 0.2.0
