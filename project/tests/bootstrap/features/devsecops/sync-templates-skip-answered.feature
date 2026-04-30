@bootstrap @devsecops @sync-templates-skip-answered
Feature: DevSecOps Code Taskfile — sync-templates passes --skip-answered
  In order to avoid re-prompting already-answered Copier questions
  As a developer running `task devsecops:code:sync-templates`
  I want the generated Taskfile.code.yml to opt into Copier's --skip-answered

  @ubuntu @ttyd
  Scenario: Generated Taskfile.code.yml wires --skip-answered into sync-templates
    Given a generated toolbox project is mounted in a fresh Ubuntu ttyd container
    When I open the web terminal
    And I type "cat .config/devsecops/Taskfile.code.yml" in the terminal and wait for completion
    Then the terminal output should visually match "devsecops-taskfile-code"
