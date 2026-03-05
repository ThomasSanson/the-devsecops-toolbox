@copier @scaffolding @gitlab @variables
Feature: GitLab CI Variables Configuration
  As a DevSecOps engineer
  I want to configure GitLab CI variables based on my GitLab environment
  So that DOCKER_* variables are correct for my runner configuration

  @saas @default
  Scenario: Generate project with GitLab SaaS variables (default)
    Given a clean temporary directory for "gitlab/variables" tests
    When the copier command is executed with CI platform "gitlab_saas"
    Then the GitLab CI variables should contain "DOCKER_HOST: tcp://docker:2376"
    And the GitLab CI variables should contain "DOCKER_TLS_CERTDIR: \"/certs\""
    And the GitLab CI variables should contain "TASK_DEVSECOPS_RELEASE_PUSH_TOKEN: $TASK_COMMITIZEN_TOKEN"
    And the GitLab CI variables should contain "TASK_DEVSECOPS_RELEASE_GITLAB_API_URL: $CI_API_V4_URL"
    And the GitLab CI variables should contain "TASK_DEVSECOPS_RELEASE_GIT_SERVER_HOST: $CI_SERVER_HOST"
    And the GitLab CI variables should NOT contain "CZ_DEPLOY_KEY"
    And the GitLab CI variables should NOT contain "TASK_DEV_INIT_DEPLOY_KEY_PATH"
    And the GitLab CI variables should NOT contain "TASK_DEVSECOPS_RELEASE_DEPLOY_KEY"

  @self-hosted
  Scenario: Generate project for GitLab Self-Hosted with custom Docker settings
    Given a clean temporary directory for "gitlab/variables" tests
    When the copier command is executed with:
      | ci_platform               | gitlab_self_hosted |
      | gitlab_docker_host        |                    |
      | gitlab_docker_tls_certdir |                    |
    Then the GitLab CI variables should contain "DOCKER_TLS_CERTDIR: \"\""
    And the GitLab CI variables should NOT contain "DOCKER_HOST: tcp://docker:2376"
