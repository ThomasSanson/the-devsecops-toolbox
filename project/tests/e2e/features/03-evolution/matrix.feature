@e2e
Feature: Template rendering matrix, every Copier answer renders the expected project
  As a DevSecOps engineer
  I want every Copier answer (runtime, compose, CI platform, Ansible,
  automerge, project mode, Gherkin language) to render the expected files
  So that a template bug in any answer, default or not, can never ship silently

  # ONE story in two chapters, told on GitLab. Chapter 1 renders the
  # working-branch template with every default answer and pushes it as the
  # main branch of a throwaway GitLab project. Chapter 2 renders the SAME
  # project again once per non-default answer, pushes each render as its own
  # branch, and shows GitLab's compare page of that branch against the main
  # branch: every changed file in the Files panel, the telling ones unfolded.
  # The seven compare cards are shot from the same page, so the reader
  # compares panels, not pages.
  #
  # ONE sentence = ONE card = ONE pixel baseline, asserted inside the step
  # (tolerance: 0). Each card is twinned with the same fact checked by code:
  # the render on disk, GitLab's REST compare (the exact list of changed
  # files), GitLab's CI lint of the main branch and of the self-hosted branch.
  #
  # These are fresh renders, not updates: copier update keeps files a project
  # already has. The update path is the @toolbox-update story.
  @render-matrix
  Scenario: the default render is canonical, and each answer changes exactly what it promises
    # Chapter: What the default project looks like on GitLab
    # Note: The working-branch template rendered with every default answer, then pushed as the main branch of a new GitLab project. GitLab shows the answers file Copier wrote: container_runtime: docker, use_docker_compose: true, ansible_enabled: false, ci_platform: gitlab_saas, gherkin_language: en.
    # Note: The project's random name shows as "project", and dates and avatars are hidden, so the picture is the same on every run.
    # Copy: uvx --python 3.14 --from copier==9.14.3 copier copy --defaults --skip-tasks /workspace acme
    Given GitLab holds a project rendered with every default Copier answer on its main branch
    # Note: The repository page of the main branch. The project folder sits next to .agent, .config, .devcontainer and docs, and the root files run from .dockerignore to lefthook.yml.
    # Note: There is no README.md between LICENSE and Taskfile.yml: the toolbox keeps its own README out of the projects it generates.
    # Copy: http://gitlab/<lambda-user>/<project>/-/tree/main
    Then the main branch carries the project workspace and leaves the toolbox README out
    # Note: The .config/codeceptjs folder on the main branch. README.md is in its list, and GitLab renders it under the list: "Storyboard engine (.config/codeceptjs/storyboard.js)".
    # Note: This is the storyboard engine's manual, the same file as in the toolbox.
    # Copy: http://gitlab/<lambda-user>/<project>/-/tree/main/.config/codeceptjs
    And the storyboard engine folder on the main branch ships its own manual
    # Chapter: Each answer changes exactly what it promises, one branch per answer
    # Note: The same project rendered again with container_runtime: podman and pushed as the branch podman. GitLab's compare page shows what that branch changes against the main branch: the Files panel lists every changed file, the diffs unfold the telling ones.
    # Note: Ten files change: the docker-ce files leave (their .gitignore moves to the podman folder), the podman files arrive and project/docker-compose.yml is deleted. Taskfile.yml is unfolded: its docker-ce include goes, and a podman include arrives further down.
    # Copy: uvx --python 3.14 --from copier==9.14.3 copier copy --defaults --skip-tasks --data container_runtime=podman /workspace acme
    Then choosing podman swaps docker-ce and compose for podman and changes nothing else
    # Note: The same page for the branch no-compose. Only two files change: the answers file, where use_docker_compose turns false, and project/docker-compose.yml, deleted.
    # Note: The docker-ce files are not in the list, so they stay as they were.
    # Copy: uvx --python 3.14 --from copier==9.14.3 copier copy --defaults --skip-tasks --data use_docker_compose=false /workspace acme
    And turning off Docker Compose only deletes the compose file
    # Note: The same page for the branch ansible. Four new files arrive under .config/ansible and .config/ansible-lint, shown folded.
    # Note: The answers file turns ansible_enabled to true, and Taskfile.yml gains the ansible include.
    # Copy: uvx --python 3.14 --from copier==9.14.3 copier copy --defaults --skip-tasks --data ansible_enabled=true /workspace acme
    And turning on Ansible only adds its config, its lint tooling and their Taskfile include
    # Note: The same page for the branch self-hosted, rendered with an empty docker host and certificate folder. Three files change.
    # Note: In tags.yml the runner tags become an empty list. In variables.yml, DOCKER_HOST: tcp://docker:2376 and the TLS settings go, DOCKER_TLS_CERTDIR turns empty and the BuildKit line is commented out. The answers file stays folded to leave room for both files.
    # Copy: uvx --python 3.14 --from copier==9.14.3 copier copy --defaults --skip-tasks --data ci_platform=gitlab_self_hosted --data gitlab_docker_host= --data gitlab_docker_tls_certdir= /workspace acme
    And a self-hosted CI platform only changes the docker-in-docker variables and the runner tags
    # Note: The same page for the branch no-project. The answers file shows project_enabled turning false, and project/Taskfile.yml and project/docker-compose.yml are deleted.
    # Note: Eleven files that called into the project folder change too, shown folded with their line counts: the root Taskfile.yml, the nine phase Taskfiles under .config/devsecops and the MegaLinter base config.
    # Copy: uvx --python 3.14 --from copier==9.14.3 copier copy --defaults --skip-tasks --data project_enabled=false /workspace acme
    And turning off project mode deletes the project directory and every task that called into it
    # Note: The same page for the branch automerge-off. The answers file turns devsecops_automerge to false.
    # Note: In .config/renovate/config.json the toolbox rule loses its four automerge lines, "automergeStrategy": "fast-forward" among them, and nothing else changes.
    # Copy: uvx --python 3.14 --from copier==9.14.3 copier copy --defaults --skip-tasks --data devsecops_automerge=false /workspace acme
    And turning off automerge only removes the fast-forward rule from the Renovate config
    # Note: The same page for the branch gherkin-fr. Six rules, skills and workflows under .agent change, each by one or two lines.
    # Note: tests-structure.md is unfolded: features/ and pages/ now ask for fr instead of en. The answers file at the bottom shows gherkin_language turning to fr.
    # Copy: uvx --python 3.14 --from copier==9.14.3 copier copy --defaults --skip-tasks --data gherkin_language=fr /workspace acme
    And choosing French Gherkin switches every test-writing rule and skill to French
