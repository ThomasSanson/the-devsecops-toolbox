@e2e @e2e-template-version-pins
Feature: A toolbox release moves its CI files to the new toolbox image
  The toolbox's own full pipeline (.gitlab-ci.yml) and its publication update
  job (.config/publication/gitlab-ci.yml) run on the toolbox image of the
  current release. The version bump must move both image lines together with
  VERSION, or one of them keeps running the tools of the release before.

  @publication-ci-version
  Scenario: A toolbox version bump moves both of its CI files to the new toolbox image
    # Note: Off camera, a throwaway copy of the toolbox, set to release 1.0.0 in its four version places so the picture never moves when the toolbox releases. One fix commit lands on its main branch, then the version bump that task release runs, here without the changelog. Before bumping, commitizen checks that both image lines hold 1.0.0, and refuses otherwise.
    # Note: On screen, the bump commit as GitLab received it. The image line of .gitlab-ci.yml, the full pipeline, and the one of .config/publication/gitlab-ci.yml, the publication update job, move from 1.0.0 to 1.0.1, together with VERSION and cz.yaml.
    # Copy: task commitizen:bump TASK_COMMITIZEN_BUMP_YES=true TASK_COMMITIZEN_BUMP_DRY_RUN=false
    Then GitLab shows the version bump moving the full pipeline and the publication update job to the new toolbox image
