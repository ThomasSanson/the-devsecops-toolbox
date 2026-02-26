@gitlab-merge-method @gitlab
Feature: GitLab Merge Method Configuration
  As a project maintainer
  I want to configure the merge method to fast-forward
  In order to maintain a clean linear git history

  Scenario: Configure merge method to fast-forward via API
    Given a lambda user with a fresh project "merge-method-test"
    When the merge method is set to fast-forward for "merge-method-test"
    Then the merge request settings show fast-forward merge for "merge-method-test"
