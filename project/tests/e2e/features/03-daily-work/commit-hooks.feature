@e2e @e2e-commitlint-dogfooding
Feature: The commit-message checks accept clean commits and reject sloppy ones
  As a developer using the toolbox
  I want my commit message to pass the checks that `task devsecops:init` installs
  (commitlint and lefthook working together)
  So that the project's own commit rules actually apply when I commit, not just on paper.

  # ONE storyboard: the commit-hooks contract as one developer journey — a
  # freshly initialized project carries the installed commit-msg hook, a
  # conventional commit sails through it, a sloppy one is turned back with
  # commitlint's own explanation. ONE Gherkin sentence = ONE storyboard card
  # = ONE pixel baseline (tolerance: 0); each verdict card twins its <pre>
  # frame with a programmatic exit-code assert of the same fact.
  @e2e-commit-hooks
  Scenario: The installed commit hooks accept conventional commits and reject sloppy ones
    Given a framework project has the commit hooks installed
    When a developer writes a conventional commit message
    Then the hooks accept it and let the commit through
    When a developer writes a sloppy commit message
    Then the hooks reject it with their own explanation
