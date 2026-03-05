@gitlab-protected-branch @gitlab
Feature: GitLab Protected Branch Configuration
  As a project maintainer
  I want to protect the main branch with strict rules
  In order to enforce code review and prevent direct pushes

  Scenario: Configure main as protected branch via API
    Given a lambda user with a fresh project "protected-branch-test"
    When the branch "main" is protected for "protected-branch-test"
    Then the repository settings show "main" as protected for "protected-branch-test"

  @gitlab-protected-branch-init
  Scenario: Configure main as protected branch via devsecops:init
    Given a GitLab runs in a container configured with user "lambda"
    And a test repository "protected-branch-init-test" is created in GitLab
    When I run "task devsecops:init" for project "protected-branch-init-test" with local authentication from workspace source
    Then the branch "main" is protected with merge for maintainers and push for no one for "protected-branch-init-test"
    And the repository settings show "main" as protected for "protected-branch-init-test"
