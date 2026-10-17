# cspell:ignore hybridciword spellling -- the project's own word and the misspelling the check must catch
@hybrid-ci
Feature: Choose a runner according to the work a job does
  The toolbox runs its file checks on an unprivileged runner and keeps Docker
  available for project tasks, without editing the generated pipeline.
  It also guards issue #162: the words a project adds to its own spelling
  dictionary survive a toolbox update. And issue #248: GitLab lists the
  project's test results, from the JUnit report its test job leaves behind.

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
    # Note: Settings, CI/CD, Runners, once the merge request pipeline has run. The project has two runners of its own: "Docker jobs" with the saas-linux-medium-amd64 tag, and "Unprivileged file checks" with no tag. The job counters read 9 for "Docker jobs" and 8 for "Unprivileged file checks": 17 of the pipeline's 18 jobs ran, and code:all, the 18th, was skipped.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/ci_cd
    When the project gets an unprivileged runner for file checks and a Docker runner for containers
    # Note: The code:megalinter job of that pipeline. Its open section, "Preparing the "docker" executor", says "Using Docker executor with image ghcr.io/oxsecurity/megalinter": the check runs straight in MegaLinter's image, and no Docker service starts. The side panel names the runner: Unprivileged file checks.
    # Note: Under "Related jobs", code:megalinter is the only red one. Commitlint and the other file checks passed, and code:all, which waits for them all, was skipped.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<code:megalinter job>
    Then MegaLinter starts directly in its own image on the unprivileged runner
    # Note: The same job further down its log, with two MegaLinter sections open. devskim reports "warning: Insecure URL" at project/code/transport.js:1:18. cspell reports "Unknown word (spellling)" in project/README.md, and does not flag "hybridciword", the project's own word.
    # Note: The job failed, and its side panel still offers the reports under "Job artifacts".
    And MegaLinter rejects the misspelled word and the insecure URL and keeps its reports
    # Note: GitLab's page for code:all in the same pipeline, the job that waits for every code check and then prints "All code checks passed." MegaLinter failed, so GitLab never started it: "This job has been skipped".
    # Note: Under "Related jobs", code:megalinter is red and code:all shows GitLab's grey skipped icon. A job whose only message is "All code checks passed." no longer goes green while one of those checks is red.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<code:all job>
    And code:all does not claim the checks passed while MegaLinter is red
    # Chapter: Keep the project settings through an update
    # Note: GitLab's Compare revisions page, from the commit the merge request opened with to the branch after the next push. That push brought two commits: "chore: update the toolbox through Copier" and "fix: correct spelling and use HTTPS".
    # Note: Only four files changed. In .copier-answers.yml, _commit moves from 1.0.0 to 1.0.1, and the toolbox's own .config/jq/Taskfile.yml gains the line "# e2e-update-marker". The README and transport.js carry the two fixes. The runner tag, the project dictionary and the lint settings are not in the list: Copier kept them.
    # Copy: http://gitlab/<lambda-user>/<project>/-/compare/<before the push>...<after the push>
    When I update the project through Copier and correct both mistakes in the same merge request
    # Note: The code:megalinter job of the new pipeline, seen from the same place in its log. devskim and cspell now pass, with the project's own word "hybridciword" still in the README, as the compare page above shows: the project dictionary came through the update. The reports are kept again under "Job artifacts", and the runner is still Unprivileged file checks.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<code:megalinter job>
    Then MegaLinter passes on the unprivileged runner and accepts both corrections
    # Note: The same code:all page in the new pipeline. Every code check passed, so GitLab ran code:all this time: its log prints "All code checks passed." and GitLab marks the job Passed. Under "Related jobs", every code check is green, code:megalinter included.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<code:all job>
    And code:all now reports that every code check passed
    # Chapter: Containers keep their own runner
    # Note: The test job of the same pipeline. Its side panel says "Runner: Docker jobs" and "Tags: saas-linux-medium-amd64". Its log starts the web application with Docker Compose, checks it and prints "PASS: the Compose web application returns the expected HTTP response".
    # Note: The side panel also reads "Test summary: 1": GitLab counted that check, as the next card shows.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<test job>
    And the Docker runner builds and tests the web application
    # Chapter: GitLab reads the test results
    # Note: The same pipeline's Tests tab, open on the suite GitLab names after the job, "test". The health check of the card above also wrote its result as a JUnit report, project/tests/_output/junit/health.xml, and the test job handed it to GitLab.
    # Note: GitLab reads "1 tests", "0 failures", "0 errors" and "100% success rate", then lists the check by its name, "the Compose web application returns the expected HTTP response", with a green tick. The test job hands GitLab every JUnit file the tests leave in an _output/junit folder under project/.
    # Copy: http://gitlab/<lambda-user>/<project>/-/pipelines/<pipeline>/test_report
    And GitLab lists the web application's test on the pipeline's Tests tab
