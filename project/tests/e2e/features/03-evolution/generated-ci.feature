@e2e @generated-ci
Feature: the CI a generated project ships is valid
  As a maintainer evolving the template
  I want proof that the .gitlab-ci.yml a new project ships is valid
  So that a template change that breaks the generated CI cannot slip by unseen.

  # A generated project's .gitlab-ci.yml is the plan GitLab follows on every
  # change: it pulls the whole DevSecOps pipeline (build, tests, security scans)
  # in from local include files. Nothing in the suite proved that plan is even
  # valid. This story renders a vanilla project, pushes it to the in-repo GitLab,
  # and asks GitLab itself whether the config holds together. That a real runner
  # executes the WHOLE pipeline to green — and the framework merge request merges
  # on it — is proven end to end by @install-complete. ONE Gherkin sentence = ONE
  # card = ONE pixel baseline (tolerance: 0); every card twins its frame with a
  # real REST fact from the embedded GitLab.

  @generated-ci-valid
  Scenario: GitLab confirms the generated CI config is valid
    # Chapter: The config every new project ships
    # Note: The .gitlab-ci.yml is the plan GitLab follows on every change. It pulls the whole DevSecOps pipeline in from local include files. If a template change broke this file, every generated project would ship a broken pipeline.
    # Copy: sed -n '13,40p' .gitlab-ci.yml
    Given a freshly generated project whose .gitlab-ci.yml wires in the whole DevSecOps pipeline
    # Chapter: GitLab checks the config
    # Note: GitLab reads the config the way it would before running it and reports whether it holds together: no bad syntax, no missing include. This is the fast guardrail. If a change ever breaks the generated config, this card turns red.
    # Copy: curl --header "PRIVATE-TOKEN: <token>" "http://gitlab/api/v4/projects/<id>/ci/lint?ref=main"
    Then GitLab lints that config and reports it is valid
