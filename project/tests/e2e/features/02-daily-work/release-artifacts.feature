@e2e @release-artifacts
Feature: the first release stamps the version into every file that tracks it
  As a developer shipping a freshly generated project
  I want the first `task release` to leave a real tag, a changelog entry and a
  version bump behind
  So that the release is something people can actually find and deploy.

  # A freshly generated project starts at 0.1.0. This story runs the release's
  # own version-bump step (Commitizen) for real on that project and proves the
  # deliverables it leaves behind: VERSION and the Helm chart move to 0.2.0, a
  # plain 0.2.0 tag (no v prefix) is stamped, and the changelog opens a 0.2.0
  # section. ONE Gherkin sentence = ONE card = ONE pixel baseline (tolerance: 0);
  # every card twins its terminal frame with a git/file check of the same fact.
  Scenario: the first release lands the tag, the changelog and the version bump
    # Note: A brand-new project starts at version 0.1.0 — both its VERSION file and its Helm chart say 0.1.0 — and the developer has just committed a feature worth releasing.
    # Copy: cat VERSION ; grep version: iac/helm/Chart.yaml
    Given a freshly generated project sitting at version 0.1.0
    # Note: task release runs Commitizen, which reads the feature commit, sees a new feature and moves the project from 0.1.0 up to 0.2.0.
    # Copy: TASK_COMMITIZEN_BUMP_YES=true TASK_COMMITIZEN_BUMP_CHANGELOG=true task commitizen:bump
    When the first release bumps the version
    # Note: The new number 0.2.0 is written into VERSION and into the Helm chart, so the machine and the deployment agree on which version this is.
    # Copy: git show HEAD:VERSION ; git show HEAD:iac/helm/Chart.yaml
    Then VERSION and the Helm chart both carry the new 0.2.0
    # Note: The release also stamps a git tag that is just the number with no v in front (the cz.yaml tag_format $version), and opens the changelog with a 0.2.0 section.
    # Copy: git tag ; grep '## 0.2.0' CHANGELOG.md
    And it stamps a plain 0.2.0 tag and opens the changelog
