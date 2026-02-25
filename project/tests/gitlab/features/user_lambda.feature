@gitlab-user-lambda
Feature: GitLab Lambda User
  As an administrator
  I want to create a standard user account
  In order to verify their homepage displays correctly

  Scenario: Create a lambda user and verify their homepage
    Given a lambda user is created via the GitLab API
    When I log in to GitLab as the lambda user
    Then the GitLab homepage is displayed
    And the GitLab lambda user homepage matches the visual reference
