@devsecops @commitlint @remove-bun
Feature: Commitlint uses npx instead of bun
  As a DevSecOps engineer
  I want commitlint to use npx for execution
  So that bun is no longer a dependency of the toolbox

  Scenario: Generated project commitlint uses npx
    Given a generated project from the Copier template
    Then the ".config/bun" directory should NOT exist
    And the file ".config/commitlint/Taskfile.yml" should contain "node_modules/.bin/commitlint"
    And the file ".config/commitlint/Taskfile.yml" should contain "npm install --prefix"
    And the file ".config/commitlint/Taskfile.yml" should NOT contain "bunx"
    And the file "Taskfile.yml" should NOT contain "bun:"
