@copier @scaffolding @gitlab @proxy
Feature: GitLab CI Proxy Configuration
  As a DevSecOps engineer
  I want to configure proxy settings for my CI/CD pipeline
  So that CI jobs can access external resources through corporate proxies

  @no-proxy @default
  Scenario: Generate project without proxy configuration (default)
    Given a clean temporary directory for "gitlab/proxy" tests
    When the copier command is executed with proxy enabled "false"
    Then the GitLab CI variables should NOT contain proxy configuration
    And the ".env.dist" file should NOT contain proxy variables

  @with-proxy
  Scenario: Generate project with proxy configuration
    Given a clean temporary directory for "gitlab/proxy" tests
    When the copier command is executed with proxy enabled "true" and proxies configured with:
      | http_proxy  | http://proxy.example.com:8080  |
      | https_proxy | https://proxy.example.com:8443 |
      | no_proxy    | localhost,127.0.0.1            |
    Then the GitLab CI variables should contain HTTP_PROXY "http://proxy.example.com:8080"
    And the GitLab CI variables should contain HTTPS_PROXY "https://proxy.example.com:8443"
    And the GitLab CI variables should contain NO_PROXY "localhost,127.0.0.1"
    And the ".env.dist" file should contain proxy variables

  @update
  Scenario: Update project to add proxy configuration
    Given a clean temporary directory for "gitlab/proxy" tests
    And a project was generated with proxy disabled
    When the project is updated with proxy enabled "true" and proxies configured with:
      | http_proxy  | http://proxy.example.com:8080 |
    Then the GitLab CI variables should contain HTTP_PROXY "http://proxy.example.com:8080"

  @update
  Scenario: Update project to remove proxy configuration
    Given a clean temporary directory for "gitlab/proxy" tests
    And a project was generated with proxy enabled and proxies configured with:
      | http_proxy | http://proxy.example.com:8080 |
    When the project is updated with proxy disabled
    Then the GitLab CI variables should NOT contain proxy configuration
