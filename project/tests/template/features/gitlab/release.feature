@copier @scaffolding @gitlab @release
Feature: GitLab Release Job Branch Lock Safety
  As a DevSecOps engineer
  I want the release job to enforce branch lock restoration in after_script
  So that default branch push access is locked back even outside the release task trap

  @after-script-lock
  Scenario: Release job includes a defensive after_script lock step
    Given a clean temporary directory for "gitlab/release" tests
    When the copier command is executed with CI platform "gitlab_saas"
    Then the file ".config/gitlab/ci/devsecops/release.yml" should contain "after_script:"
    And the file ".config/gitlab/ci/devsecops/release.yml" should contain "task glab:release:lock-default-branch || true"
    And the file ".config/devsecops/Taskfile.release.yml" should contain "task glab:release:lock-default-branch"
    And the file ".config/glab/Taskfile.yml" should contain "release:lock-default-branch:"
    And the file ".config/devsecops/Taskfile.release.yml" should NOT contain "gitlab:lock-default-branch:"
