@gitlab-protected-branch @gitlab
Feature: GitLab Protected Branch Configuration
  As a project maintainer
  I want to protect the main branch with strict rules
  In order to enforce code review and prevent direct pushes

  Scenario: Configure main as protected branch via API
    Given a lambda user with a fresh project "protected-branch-test"
    When the branch "main" is protected for "protected-branch-test"
    Then the repository settings show "main" as protected for "protected-branch-test"
