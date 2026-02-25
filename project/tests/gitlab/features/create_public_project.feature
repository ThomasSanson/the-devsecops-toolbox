@gitlab-create-public-project @gitlab
Feature: GitLab Public Project Creation
  As a lambda user
  I want to create a new public project
  In order to prepare the ground for future configuration tests

  Scenario: Create a public project as a lambda user
    Given a lambda user is created via the GitLab API
    And the test project is deleted if it exists
    And I log in to GitLab as the lambda user
    When I create a new public test project
    Then the new public project page is displayed
    And the new public project page matches the visual reference
