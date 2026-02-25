@gitlab-connexion
Feature: GitLab Login
  As a user
  I want to log in to GitLab
  In order to access the dashboard

  Scenario: Login with root credentials
    When I log in to GitLab with root credentials
    Then the GitLab dashboard is displayed
    And the GitLab dashboard page matches the visual reference
