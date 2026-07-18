@e2e @fresh-machine
Feature: Trusting the installer on a fresh machine
  As a developer trying the DevSecOps Toolbox on a brand-new machine
  I want the installer to add the tools it is missing by itself, and to keep
  working even when I run it the short documented way (piped into bash)
  So that I can trust it from a cold start, whichever way I launch it

  # ONE story in two chapters, each in its OWN fresh sandbox (they never share
  # state). ONE Gherkin sentence = ONE card = ONE pixel baseline, asserted
  # inside the step (tolerance: 0); each result card twins its frame with a
  # check of the same fact — a line in the install log, or the GitLab API.
  #
  # Chapter 1 — a barren Ubuntu machine with only sudo and curl: the installer
  # adds the one tool it is missing (unzip) with sudo, then stops on purpose
  # because the project has no GitLab link yet, printing the exact next step.
  # Nothing here touches GitLab, so the proofs read the captured output.
  # Chapter 2 — the documented one-liner (curl ... | bash): piping hides the
  # real terminal, so the installer reads your keystrokes through /dev/tty and
  # stays interactive all the way to the finished screen and the framework
  # merge request (the page where changes get reviewed before joining main).
  Scenario: The installer fixes its own gaps, and stays interactive even when piped
    # Chapter: A bare machine sets itself up
    Given a fresh machine has only sudo and curl, with the installer ready to run
    When the installer runs on the fresh machine with no one to answer its questions
    Then the installer installs the tool it was missing and tries again
    And the installer stops and explains how to link the project to GitLab
    # Chapter: The one-line install stays interactive
    Given a developer follows the README and pipes the installer into bash
    When the installer still asks what to install, even when piped into bash
    Then the piped install finishes and opens the framework merge request
