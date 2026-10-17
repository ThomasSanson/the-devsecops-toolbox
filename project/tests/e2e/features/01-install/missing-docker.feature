@e2e
Feature: The installer says when Docker is missing, before it sets up the project
  As a developer installing the toolbox on a machine without Docker
  I want the installer to tell me Docker is missing and where to get it
  So that the first task that starts a container does not fail without a word of why

  # The README lists Docker among the prerequisites, and the installer never
  # checked it: on a machine without Docker the install went through, and the
  # first task that starts a container failed later on Docker's own error. The
  # installer now says so before it sets up the project. It does not stop there:
  # nothing it does needs Docker, and a CI job brings its own.
  #
  # ONE throwaway Ubuntu machine with curl and git, the toolbox's tools already
  # installed, no Docker and no Podman, and ONE live terminal in an empty project
  # folder. ONE Gherkin sentence = ONE card = ONE pixel baseline (tolerance: 0),
  # each twinned in its step with a check of the same fact.
  @missing-docker
  Scenario: On a machine without Docker, the installer names what to install and goes on to the setup questions
    # Note: A fresh machine where the toolbox will be installed. The shell finds neither docker nor podman, the two programs that run containers.
    # Copy: type docker podman
    Given a developer's machine has neither Docker nor Podman
    # Note: The developer starts the installer and, asked what to install, picks the complete framework. Before it sets anything up, the installer warns: "Docker does not answer on this machine: it is missing, or not running."
    # Note: The next two lines say why it matters, task code, task build and task test run their tools in containers, and where to get Docker. Then the installer goes on: Copier asks its first setup question, "Do you need Ansible?".
    # Copy: curl -fsSL https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/raw/main/.config/devsecops/install.sh -o /tmp/devsecops-install.sh && bash /tmp/devsecops-install.sh
    When the developer starts the installer, it warns that Docker is missing, says where to get it, and goes on to the setup questions
