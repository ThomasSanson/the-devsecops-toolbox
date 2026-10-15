@hybrid-ci
Feature: Choose a runner according to the work a job does
  The toolbox runs its file checks on an unprivileged runner and keeps Docker
  available for project tasks, without editing the generated pipeline.
  It also guards issue #162: the words a project adds to its own spelling
  dictionary survive a toolbox update.

  Scenario: Generate a self-hosted project with separate runners for checks and Docker
    # Chapter: Choose the Docker runners
    # Note: GitLab's page for .config/gitlab/ci/tags.yml on the main branch of the generated project. The file keeps the runner tag given to Copier, ["saas-linux-medium-amd64"], and its comment says who uses it: "Runner selection for Docker jobs. Native checks use .native-job instead."
    # Note: The project's random name shows as "project". Its only commit is "chore: initial render".
    # Copy: http://gitlab/<lambda-user>/<project>/-/blob/main/.config/gitlab/ci/tags.yml
    Given I generate a self-hosted project using the saas-linux-medium-amd64 Docker runner tag and push it to GitLab
    # Chapter: Add the application
    # Note: The merge request's Changes tab. The file tree lists the 11 files it adds or changes, and .gitlab-ci.yml is not one of them: the web application runs on the generated pipeline as it is.
    # Note: The web application's plumbing is folded to its file names. The open diffs give the project dictionary .config/cspell/config.project.json its own word, "hybridciword", and add the project's own lint settings in project/quality/megalinter.yml. project/code/transport.js holds the first deliberate mistake, an http URL. project/README.md holds the second, the misspelled word "spellling".
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1/diffs
    When I open a merge request that adds the web application, its own lint settings and two deliberate mistakes
    # Chapter: Run the checks on real runners
    # Note: Settings, CI/CD, Runners, once the merge request pipeline has run. The project has two runners of its own: "Docker jobs" with the saas-linux-medium-amd64 tag, and "Unprivileged file checks" with no tag. The job counter beside each one reads 9: each took 9 of the pipeline's 18 jobs.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/ci_cd
    When the project gets an unprivileged runner for file checks and a Docker runner for containers
    # Note: The code:megalinter job of that pipeline. Its open section, "Preparing the "docker" executor", says "Using Docker executor with image ghcr.io/oxsecurity/megalinter": the check runs straight in MegaLinter's image, and no Docker service starts. The side panel names the runner: Unprivileged file checks.
    # Note: Under "Related jobs", code:megalinter is the only red one. Commitlint and the other file checks passed.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<code:megalinter job>
    Then MegaLinter starts directly in its own image on the unprivileged runner
    # Note: The same job further down its log, with two MegaLinter sections open. devskim reports "warning: Insecure URL" at project/code/transport.js:1:18. cspell reports "Unknown word (spellling)" in project/README.md, and does not flag "hybridciword", the project's own word.
    # Note: The job failed, and its side panel still offers the reports under "Job artifacts".
    And MegaLinter rejects the misspelled word and the insecure URL and keeps its reports
    # Chapter: Keep the project settings through an update
    # Note: GitLab's Compare revisions page, from the commit the merge request opened with to the branch after the next push. That push brought two commits: "chore: update the toolbox through Copier" and "fix: correct spelling and use HTTPS".
    # Note: Only four files changed. In .copier-answers.yml, _commit moves from 1.0.0 to 1.0.1, and the toolbox's own .config/jq/Taskfile.yml gains the line "# e2e-update-marker". The README and transport.js carry the two fixes. The runner tag, the project dictionary and the lint settings are not in the list: Copier kept them.
    # Copy: http://gitlab/<lambda-user>/<project>/-/compare/<before the push>...<after the push>
    When I update the project through Copier and correct both mistakes in the same merge request
    # Note: The code:megalinter job of the new pipeline, seen from the same place in its log. devskim and cspell now pass, with the project's own word "hybridciword" still in the README, as the compare page above shows: the project dictionary came through the update. The reports are kept again under "Job artifacts", and the runner is still Unprivileged file checks.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<code:megalinter job>
    Then MegaLinter passes on the unprivileged runner and accepts both corrections
    # Chapter: Containers keep their own runner
    # Note: The test job of the same pipeline. Its side panel says "Runner: Docker jobs" and "Tags: saas-linux-medium-amd64". Its log starts the web application with Docker Compose, checks it and prints "PASS: the Compose web application returns the expected HTTP response".
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<test job>
    And the Docker runner builds and tests the web application

  @runner-cleanup
  Scenario: Register another project runner while a job still needs its checkout helper
    # Note: This story checks the test suite's own runner setup, not a toolbox feature. The page of the first project's job: it is Running, and its log stops on the loop "$ while [ ! -f /tmp/job-release ]; do sleep 1; done", where the job waits.
    # Note: No "Uploading artifacts" section yet. GitLab Runner will upload result.txt later, through the job's checkout helper container, which has already stopped.
    # Copy: http://gitlab/<lambda-user>/<first-project>/-/jobs/<job>
    Given the first project's job is running and still has to upload its artifact
    # Note: The second project's CI/CD settings, Runners section. Its one runner carries the saas-linux-medium-amd64 tag and has run no job yet: GitLab lists it Offline and Idle. It was registered in the same runner service while the first job was still running.
    # Copy: http://gitlab/<lambda-user>/<second-project>/-/settings/ci_cd
    When the second project registers its own runner
    # Note: The first job's page once its script is released. It Passed: its log shows "Uploading artifacts for successful job", "result.txt: found 1 matching artifact files and directories" and "201 Created", and its side panel offers the artifact under "Job artifacts".
    # Copy: http://gitlab/<lambda-user>/<first-project>/-/jobs/<job>
    Then GitLab accepts the first job artifact and marks the job as passed
