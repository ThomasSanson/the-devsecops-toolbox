@e2e @e2e-commitlint-dogfooding
Feature: The toolbox's commitlint + lefthook chain accepts conventional commits
  As a developer using the toolbox
  I want a Commitizen-style commit message to pass the pre-commit / commit-msg
  hooks installed by `task devsecops:init`
  So that the dogfooded commit convention actually holds on the contributor side.

  @e2e-commitlint-dogfooding-accept
  Scenario: A conventional commit message passes the hooks
    Given a GitLab runs in a container configured with user "lambda"
    And a test repository "e2e-commitlint-accept" is created in GitLab
    When I run the command "task devsecops:init" for project "e2e-commitlint-accept" with local authentication
    And I create an empty commit "feat: dogfood the commitlint hook" in project "e2e-commitlint-accept"
    Then the commit must be accepted by the hooks
    When the commit output is displayed in the browser
    Then the commit output should visually match "e2e_commitlint_dogfooding_accept_terminal"
