@hybrid-ci
Feature: Choose a runner according to the work a job does
  The toolbox runs its file checks on an ordinary runner and keeps Docker
  available for project tasks, without editing the generated pipeline.

  Scenario: Generate a self-hosted project with separate runners for checks and Docker
    # Chapter: Choose the Docker runners
    # Note: Copier keeps the existing runner tag exactly as entered. The project does not need a private copy of the toolbox to choose its Docker runners.
    Given I generate a self-hosted project using the saas-linux-medium-amd64 Docker runner tag
    # Note: GitLab resolves the whole generated pipeline. File checks have no tag and no service; project tasks retain Docker because their commands may start containers.
    Then GitLab validates the complete generated pipeline
    # Chapter: Add the application
    # Note: The project Taskfile defines the application tasks. The generated pipeline stays unchanged and keeps Docker available to those tasks.
    When I add the web application without changing the generated pipeline
    # Note: The input is visible before the verdict: a project word, a misspelled word, and an insecure URL. Both project lint hooks must still run.
    Then my project has its own lint settings and two mistakes to catch
    # Chapter: Run the checks on real runners
    # Note: The job runs with privileged mode disabled, without a Docker socket or a Docker service. The real job page identifies its runner; only the bootstrap before the check is collapsed.
    Then Commitlint passes on the unprivileged runner
    # Note: The job page and the observed container agree: MegaLinter runs directly in its own image with privileged mode disabled and no Docker socket. Only image preparation is expanded; GitLab keeps the other log sections folded.
    And MegaLinter starts directly in its own image on the unprivileged runner
    # Note: This is the full spelling report downloaded from the job artifacts. The project dictionary accepts its own word, but the deliberate spelling mistake still fails the job.
    And MegaLinter rejects a spelling mistake and publishes its reports
    # Note: The full security report points at the HTTP URL in the project source. The security scanner is active on the ordinary runner too.
    And the security scan also rejects the insecure URL
    # Chapter: Keep the project settings through an update
    # Note: Copier advances the toolbox version. The Docker runner tag, project dictionary, lint hooks and Task settings are preserved exactly.
    When I update the project through Copier and keep my own settings
    # Note: I fix the misspelled word and switch the URL to HTTPS. The rules, project dictionary and lint hooks stay in place.
    When I correct both mistakes without changing the lint configuration
    # Note: The same GitLab job page now shows a passing job. Its image, runner, project hooks and downloadable reports are unchanged.
    Then MegaLinter passes on the unprivileged runner
    # Note: This is the same spelling report as before, downloaded after the correction. The project dictionary remains active and the scan passes.
    And the spelling scan accepts the corrected file
    # Note: The same security scanner now passes. The change fixed the source file; no security rule was disabled.
    And the security scan accepts the corrected HTTPS URL
    # Chapter: Containers keep their own runner
    # Note: The build, deploy and test jobs use the tagged Docker runner. The HTTP test talks to the running Compose service and checks the response body.
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
