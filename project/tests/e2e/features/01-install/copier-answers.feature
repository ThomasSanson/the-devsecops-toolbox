# cspell:ignore francais
@e2e
Feature: Copier refuses an answer the new project could not use
  As a developer answering the toolbox's setup questions
  I want a mistyped answer refused on the spot
  So that a typo never lands quietly in my project's files

  # Copier asks the setup questions and copies each answer into the files of
  # the new project. It used to take anything. A Gherkin language typed in full,
  # "francais", went into the AI agent's rules as a language nobody can write
  # in, and a space after the colon of a Docker address broke the YAML of the CI
  # file, found only when the first pipeline refused to start. Copier now takes
  # only the 80 language codes of Gherkin, the language the tests are written
  # in, and checks how each Docker answer starts.
  #
  # Each card is the real terminal of the test container: one typed line and its
  # whole answer, against the toolbox's working branch in /workspace.
  # ONE Gherkin sentence = ONE card = ONE pixel baseline (tolerance: 0), each
  # twinned in its step with a check of the same fact.
  @copier-gherkin-language
  Scenario: Copier refuses a Gherkin language it does not know, and takes its code
    # Note: The developer means French and types the word: gherkin_language=francais. Copier stops on its own message, "Validation error for question 'gherkin_language': "francais" is not a language Gherkin knows.", and names codes it takes: en, fr, de or es.
    # Note: The exit code is 1, and ls finds no acme folder: Copier wrote not a single file.
    # Copy: uvx --python 3.14 --from copier==9.14.3 copier copy --quiet --defaults --skip-tasks --data gherkin_language=francais /workspace acme 2>&1 | tail -n 1; echo "exit code ${PIPESTATUS[0]}"; ls -d acme && grep -r "# language:" acme/.agents | sort
    When a developer answers francais for the Gherkin language, and Copier refuses before it writes a single file
    # Note: The same line with fr, the code Gherkin gives French. Copier prints nothing, the exit code is 0, and ls finds the acme folder.
    # Note: The two AI agent rules that name the first line of a test file now ask for "# language: fr", the line a French Gherkin file starts with.
    # Copy: uvx --python 3.14 --from copier==9.14.3 copier copy --quiet --defaults --skip-tasks --data gherkin_language=fr /workspace acme 2>&1 | tail -n 1; echo "exit code ${PIPESTATUS[0]}"; ls -d acme && grep -r "# language:" acme/.agents | sort
    Then the same line with fr writes the project, and its agent rules ask for Gherkin in fr

  @copier-docker-answers
  Scenario: Copier refuses a malformed Docker answer, and the CI file stays valid YAML whatever the address holds
    # Note: A project whose CI runs on its own GitLab runners answers three Docker questions. The loop gives each one a common mistake: an address without tcp://, a certificate folder that is not a full path, and overlay, a storage driver Docker no longer has.
    # Note: Copier refuses all three, each on the line under its answer. The first two messages say what to type instead. The driver gets "Invalid choice": it can only be one of five names. ls finds no runner folder, --overwrite or not.
    # Copy: for answer in gitlab_docker_host=docker:2376 gitlab_docker_tls_certdir=certs gitlab_docker_driver=overlay; do echo "$answer"; uvx --python 3.14 --from copier==9.14.3 copier copy --quiet --defaults --skip-tasks --overwrite --data ci_platform=gitlab_self_hosted --data "$answer" /workspace runner 2>&1 | tail -n 1; done; ls -d runner
    When a project on its own runners gets a Docker address without tcp://, a relative certificate folder and an unknown storage driver, and Copier refuses each one
    # Note: This address starts right, but a space slipped in after its colon: tcp://docker: 2376. Copier only checks how an address starts, so it takes it.
    # Note: The CI file holds the address in quotes, "tcp://docker: 2376". task yamllint, the project's own YAML check, ends on "All files correctly linted with yamllint!": the CI file is valid YAML.
    # Copy: uvx --python 3.14 --from copier==9.14.3 copier copy --quiet --defaults --skip-tasks --data ci_platform=gitlab_self_hosted --data "gitlab_docker_host=tcp://docker: 2376" /workspace runner && grep "^ *DOCKER_HOST:" runner/.config/gitlab/ci/variables.yml && task -d runner yamllint TASK_YAMLLINT_PATH_TO_LINT=.config/gitlab/ci/variables.yml
    Then an address with a space after its colon still gives a CI file that yamllint accepts
