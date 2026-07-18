@e2e @e2e-journey @e2e-journey-installer
Feature: Developer journey — running the installer and answering its setup questions
  As a developer adopting the DevSecOps Toolbox
  I want to run the installer on my own machine and answer its setup questions
  So that the project is built from the toolbox version I am really testing

  # ONE Gherkin sentence = ONE storyboard card = ONE pixel baseline, asserted
  # inside the step itself (tolerance: 0): a visual regression fails on the
  # exact sentence whose image drifted. The storyboard SVG — selectable,
  # copyable text around the untouched frames, including the command that
  # replays the scenario — is assembled automatically when the scenario ends.
  # The Given closes the off-camera stage (lambda user, blank cloned project,
  # staged working-branch installer, pre-installed toolchain, glab auth) with
  # its visual proof, and each Then pairs its card with a programmatic assert
  # of the same fact (ls in the container, REST on the remote) so a regression
  # fails loud even without eyes.
  #
  # Two scenarios share the installer feature: the FULL storyboard walks the
  # whole Copier questionnaire, one card per question, re-capturing the same
  # anchored moments the retired copier-*-terminal baselines proved
  # (@e2e-journey-installer-full); the VARIANT proves the documented
  # `curl … | bash` transport stays interactive through the /dev/tty fallback
  # (@e2e-journey-installer-piped). Both scaffold from the WORKING-BRANCH
  # template, never curl-from-main.
  @e2e-journey-installer-full
  Scenario: A developer answers all the setup questions and builds the framework
    Given a developer has just cloned a brand-new empty project into the terminal
    When the developer starts the toolbox installer
    And the developer keeps the complete framework and the first question asks about Ansible
    And the developer keeps GitLab as the CI/CD platform
    And the developer keeps Docker as the container runtime
    And the developer keeps the generated docker-compose file
    And the developer keeps the project workspace enabled
    And the developer keeps Renovate auto-merge enabled
    And the developer keeps English as the Gherkin language
    Then the installer builds the project and shows the finished screen
    And the project folder now holds the full DevSecOps framework

  # The documented one-liner: `curl …/install.sh | bash`. Inside the pty the
  # installer's stdin is a PIPE, so the Copier questions only stay interactive
  # through its /dev/tty fallback — this variant proves that path end to end,
  # with its own per-scenario baselines (parallel workers never share actual
  # paths).
  @e2e-journey-installer-piped
  Scenario: Piping the installer into bash still lets you answer the questions
    Given a developer follows the README and pipes the installer into bash
    When the installer still asks what to install, even when piped into bash
    Then the piped install finishes and opens the framework merge request
