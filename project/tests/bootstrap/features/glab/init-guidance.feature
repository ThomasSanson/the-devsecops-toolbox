@bootstrap @glab @bootstrap-glab-guidance
Feature: Bootstrap guidance for GitLab authentication and remote alignment
  As a first-time toolbox user
  I want init failures related to glab to provide actionable guidance
  So that I can recover quickly and re-run the initialization command

  Scenario: Missing authentication on a GitLab remote suggests how to log in
    Given a generated toolbox project is mounted in a fresh Ubuntu bootstrap container
    When I run "sudo apt-get update -qq && sudo apt-get install -y -qq git unzip curl" in the Ubuntu bootstrap container
    Then the bootstrap command should succeed
    When I run "sudo git init -q && sudo git config user.email bootstrap@example.com && sudo git config user.name Bootstrap && sudo git commit --allow-empty -m 'bootstrap init' && sudo git remote add origin https://gitlab.com/example/bootstrap-guidance.git" in the Ubuntu bootstrap container
    Then the bootstrap command should succeed
    When I run "sudo task devsecops:init" in the Ubuntu bootstrap container
    Then the bootstrap command should fail
    And the bootstrap command output should contain "Run 'task glab:auth' to authenticate."
    And the bootstrap command output should contain "glab auth login"
    And the bootstrap command output should contain "task devsecops:init"

  Scenario: Non-GitLab remote suggests how to align the repository host
    Given a generated toolbox project is mounted in a fresh Ubuntu bootstrap container
    When I run "sudo apt-get update -qq && sudo apt-get install -y -qq git unzip curl" in the Ubuntu bootstrap container
    Then the bootstrap command should succeed
    When I run "sudo git init -q && sudo git config user.email bootstrap@example.com && sudo git config user.name Bootstrap && sudo git commit --allow-empty -m 'bootstrap init' && sudo git remote add origin https://github.com/example/bootstrap-guidance.git" in the Ubuntu bootstrap container
    Then the bootstrap command should succeed
    When I run "sudo task devsecops:init" in the Ubuntu bootstrap container
    Then the bootstrap command should fail
    And the bootstrap command output should contain "No GitLab repository remote was detected"
    And the bootstrap command output should contain "git remote set-url origin"
    And the bootstrap command output should contain "task devsecops:init"

  Scenario: GitLab host mismatch suggests host-specific authentication
    Given a generated toolbox project is mounted in a fresh Ubuntu bootstrap container
    When I run "sudo apt-get update -qq && sudo apt-get install -y -qq git unzip curl" in the Ubuntu bootstrap container
    Then the bootstrap command should succeed
    When I run "sudo git init -q && sudo git config user.email bootstrap@example.com && sudo git config user.name Bootstrap && sudo git commit --allow-empty -m 'bootstrap init' && sudo git remote add origin https://gitlab.self-hosted.local/example/bootstrap-guidance.git" in the Ubuntu bootstrap container
    Then the bootstrap command should succeed
    When I run "sudo task devsecops:init" in the Ubuntu bootstrap container
    Then the bootstrap command should fail
    And the bootstrap command output should contain "Run 'task glab:auth' to authenticate."
    And the bootstrap command output should contain "glab auth login --hostname gitlab.self-hosted.local"
    And the bootstrap command output should contain "glab auth status --hostname gitlab.self-hosted.local"

  Scenario: Init can complete without glab guidance when GitLab setup is disabled
    Given a generated toolbox project is mounted in a fresh Ubuntu bootstrap container
    When I run "sudo apt-get update -qq && sudo apt-get install -y -qq git unzip curl" in the Ubuntu bootstrap container
    Then the bootstrap command should succeed
    When I run "sudo env TASK_GLAB_ENABLED=false task devsecops:init" in the Ubuntu bootstrap container
    Then the bootstrap command should succeed
    And the bootstrap command output should not contain "Run 'task glab:auth' to authenticate."
    And the bootstrap command output should not contain "glab auth login --hostname"
