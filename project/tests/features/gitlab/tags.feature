@copier @scaffolding @gitlab @tags
Feature: GitLab CI Tags Configuration
  As a DevSecOps engineer
  I want to configure GitLab CI runner tags based on my GitLab environment
  So that CI jobs run on the appropriate runners without getting stuck

  @saas @default
  Scenario: Generate project with GitLab SaaS tags (default)
    Given a clean temporary directory for "gitlab/tags" tests
    When the copier command is executed with CI platform "gitlab_saas"
    Then the GitLab CI tags should include "saas-linux-medium-amd64"
    And the GitLab CI code jobs should use SaaS runner tags

  @self-hosted
  Scenario: Generate project for GitLab Self-Hosted
    Given a clean temporary directory for "gitlab/tags" tests
    When the copier command is executed with CI platform "gitlab_self_hosted"
    Then the GitLab CI tags should be empty
    And the GitLab CI code jobs should NOT have hardcoded runner tags

  @update
  Scenario: Update project from GitLab SaaS to Self-Hosted
    Given a clean temporary directory for "gitlab/tags" tests
    And a project was generated with CI platform "gitlab_saas"
    When the project is updated with CI platform "gitlab_self_hosted"
    Then the GitLab CI tags should be empty
    And the GitLab CI code jobs should NOT have hardcoded runner tags

  @update
  Scenario: Update project from Self-Hosted to GitLab SaaS
    Given a clean temporary directory for "gitlab/tags" tests
    And a project was generated with CI platform "gitlab_self_hosted"
    When the project is updated with CI platform "gitlab_saas"
    Then the GitLab CI tags should include "saas-linux-medium-amd64"
    And the GitLab CI code jobs should use SaaS runner tags
