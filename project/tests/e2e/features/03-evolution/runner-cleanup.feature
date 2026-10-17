@hybrid-ci
Feature: Choose a runner according to the work a job does
  This story checks the test suite's own runner setup, not a toolbox feature:
  registering another project runner keeps the stopped checkout helper of a
  running job, and GitLab still accepts that job's artifact.

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
