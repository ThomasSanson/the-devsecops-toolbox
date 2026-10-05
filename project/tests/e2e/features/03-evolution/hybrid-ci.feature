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
    # Note: concurrent = 1 keeps Docker jobs serial. The job waits after checkout and must later upload result.txt.
    Given two projects share a serial test runner and the first job must upload an artifact
    # Note: Docker shows the build container running and the checkout helper exited with code 0. Exited does not mean the job has finished: GitLab Runner reuses this helper to upload artifacts.
    When the first job is running while its checkout helper is stopped
    # Note: The real registration helper registers the second runner. Docker discovery is bounded to this scenario's containers so the regression cannot delete a neighbour's containers; both project runners remain inside that boundary.
    When the second project registers its own runner without restarting the first job
    # Note: The same Docker inspection still shows the stopped helper and running build. Registering a runner must leave the other project's job containers alone.
    Then the first job still has its stopped checkout helper and its running build container
    # Note: The real GitLab job finishes its artifact upload and passes. The downloaded result.txt contains the first job's message.
    Then GitLab accepts the first job artifact and marks the job as passed
