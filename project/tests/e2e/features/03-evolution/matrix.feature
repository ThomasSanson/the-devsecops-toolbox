@e2e
Feature: Template rendering matrix — every Copier answer renders the expected project
  As a DevSecOps engineer
  I want every possible Copier answer (runtime, compose, CI platform, ansible,
  automerge, project mode, gherkin language) to render the expected files
  So that a template bug in any answer, default or not, can never ship silently

  # ONE story in two chapters. ONE Gherkin sentence = ONE card = ONE pixel
  # baseline, asserted inside the step (tolerance: 0). Every listing or grep
  # shown is the REAL command run against the real render — no composed output —
  # and each card twins its frame with the same filesystem check a regression
  # would trip even without eyes.
  #
  # Chapter 1 renders the template with every default answer and shows what the
  # canonical project looks like. Chapter 2 renders the template once per
  # non-default answer and shows exactly what that one answer changes, nothing
  # more.
  @render-matrix
  Scenario: the default render is canonical, and each answer changes exactly what it promises
    # Chapter: What the default project looks like
    # Note: Off-camera: the working-branch template copier-copied with every default answer — the reference render every other card in this journey is measured against.
    # Copy: cat .config/devsecops/.copier-answers.yml
    Given a project is rendered from the working-branch template with every default Copier answer
    # Note: The default render: docker-ce and compose are present, podman and ansible are absent, project/ is delivered.
    # Copy: ls -1A; ls -1A .config
    Then the rendered tree delivers the canonical docker, compose and project layout
    # Note: The storyboard engine arrives with its own manual. The toolbox's root README stays out of the generated project, which keeps its own introduction.
    # Copy: ls .config/codeceptjs/README.md README.md
    And the storyboard manual is installed while the toolbox root README stays out
    # Note: The generated root Taskfile includes the docker-ce and project taskfiles, never podman.
    # Copy: grep -E "docker-ce|project/Taskfile|podman" Taskfile.yml
    And the root Taskfile wires in the default docker-ce and compose toolchain
    # Note: The rendered CI variables target the shared docker-in-docker host, and the release job carries its after-script security gate.
    # Copy: grep DOCKER_HOST .config/gitlab/ci/variables.yml; grep after_script: .config/gitlab/ci/devsecops/release.yml
    And the CI pipeline ships the default docker-in-docker variables and release gate
    # Note: The project's own answers file, Gherkin language rule and renovate fast-forward automerge rule are all in place.
    # Copy: grep "Gherkin in" .agent/rules/tests-structure.md
    And the project's own governance and language config are delivered
    # Chapter: Each answer changes exactly what it promises
    # Note: Off-camera: a fresh default render — docker-ce and compose present, Gherkin in English — the baseline every answer below changes exactly one part of.
    # Copy: ls .config/docker-ce/Taskfile.yml project/docker-compose.yml; grep "Gherkin in" .agent/rules/tests-structure.md
    Given the default answers render docker-ce, compose and English as the baseline
    # Note: container_runtime=podman: the podman Taskfile appears, docker-ce and the compose file are both gone, and the root Taskfile points at podman instead.
    # Copy: uvx --python 3.14 --from copier==9.14.3 copier copy --defaults --data container_runtime=podman /workspace <project>
    Then choosing podman as the runtime replaces docker-ce and compose with podman config
    # Note: use_docker_compose=false: the compose file disappears while the docker-ce taskfile stays exactly as in the default render.
    # Copy: uvx --python 3.14 --from copier==9.14.3 copier copy --defaults --data use_docker_compose=false /workspace <project>
    And turning off docker compose drops the compose file but keeps docker-ce
    # Note: ansible_enabled=true: .config/ansible and .config/ansible-lint both appear, and the root Taskfile picks up the new include.
    # Copy: uvx --python 3.14 --from copier==9.14.3 copier copy --defaults --data ansible_enabled=true /workspace <project>
    And turning on Ansible delivers its config and lint tooling
    # Note: ci_platform=gitlab_self_hosted with an empty host/certdir: the shared DOCKER_HOST is gone and DOCKER_TLS_CERTDIR renders empty.
    # Copy: uvx --python 3.14 --from copier==9.14.3 copier copy --defaults --data ci_platform=gitlab_self_hosted --data gitlab_docker_host= --data gitlab_docker_tls_certdir= /workspace <project>
    And choosing a self-hosted CI platform changes the docker-in-docker variables
    # Note: project_enabled=false: the whole project/ tree is gone and the root Taskfile drops its include.
    # Copy: uvx --python 3.14 --from copier==9.14.3 copier copy --defaults --data project_enabled=false /workspace <project>
    And turning off project mode removes the project directory entirely
    # Note: devsecops_automerge=false: the toolbox package rule keeps its match but drops every automerge property, and the config stays valid JSON.
    # Copy: uvx --python 3.14 --from copier==9.14.3 copier copy --defaults --data devsecops_automerge=false /workspace <project>
    And turning off automerge removes the fast-forward rule from the renovate config
    # Note: gherkin_language=fr: the tests-structure rule now instructs the project to write its Gherkin in French.
    # Copy: uvx --python 3.14 --from copier==9.14.3 copier copy --defaults --data gherkin_language=fr /workspace <project>
    And choosing French Gherkin changes the language rule for generated tests
