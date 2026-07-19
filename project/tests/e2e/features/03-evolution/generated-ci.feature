@e2e @generated-ci
Feature: the CI a generated project ships is valid and really runs
  As a maintainer evolving the template
  I want proof that the .gitlab-ci.yml a new project ships is valid and that a
  real runner executes its pipeline
  So that a template change that breaks the generated CI cannot slip by unseen.

  # A generated project's .gitlab-ci.yml is the plan GitLab follows on every
  # change: it pulls the whole DevSecOps pipeline (build, tests, security scans)
  # in from local include files. Nothing in the suite proved that plan is even
  # valid, let alone that it runs. This story renders a vanilla project, pushes
  # it to the in-repo GitLab, and asks GitLab itself the two questions that
  # matter. ONE Gherkin sentence = ONE card = ONE pixel baseline (tolerance: 0);
  # every card twins its frame with a real REST fact from the embedded GitLab.

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

  @generated-ci-pipeline
  Scenario: a real runner runs the generated pipeline and its first job passes
    # Chapter: A runner joins the project
    # Note: A runner is the machine that actually runs pipeline jobs. The embedded GitLab has none, so this story starts one that serves only this project, then points GitLab at it. Because it is scoped to one project, it never steals jobs from other tests.
    # Copy: gitlab-runner register --url http://gitlab --executor docker
    Given a runner scoped to a freshly generated project comes online
    # Chapter: The pipeline runs for real
    # Note: The runner pulls the generated pipeline in and runs it. We watch the pipeline's first job, plan, which runs the plan phase. When it turns green, a real runner has pulled the toolbox base image and run a real job of the generated CI to success.
    # Copy: curl --header "PRIVATE-TOKEN: <token>" "http://gitlab/api/v4/projects/<id>/pipelines/<pid>/jobs"
    Then the pipeline's first job runs on that runner and passes
