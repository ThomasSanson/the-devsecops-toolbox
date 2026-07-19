@e2e
Feature: On the first run, the toolbox names the exact thing to fix
  As a developer setting up the DevSecOps Toolbox
  I want each check to stop and name the next command to run when something is missing
  So that I am never left guessing what to do next

  # ONE story in three chapters, each in its OWN fresh throwaway machine (they
  # never share state). ONE Gherkin sentence = ONE card = ONE pixel baseline,
  # asserted inside the step (tolerance: 0); every verdict card twins its frame
  # with a check of the same fact — the captured message and the exit code.
  # The auth check is `task glab:auth:ensure`; init is `task devsecops:init`.
  #
  # Chapter 1 — the auth check names each missing tool as the developer installs
  # them one at a time: gum, then glow, then the glab CLI, then the missing
  # sign-in. Chapter 2 — the check reads the GitLab host straight from the git
  # remote, and turns an SSH-style gitlabssh address back into the normal one.
  # Chapter 3 — init itself guides: it prints the exact sign-in command, refuses
  # a GitHub remote with the fix, and finishes cleanly when GitLab is turned off.
  @first-run-help
  Scenario: Every check stops and names the fix, then finishes cleanly once nothing is missing
    # Chapter: The check names each missing tool
    # Note: A throwaway toolbox checkout before any setup: gum, glow and the glab CLI are all missing. The card lists the three, none installed.
    # Copy: command -v gum glow glab
    Given a fresh toolbox checkout with none of its UI tools installed yet
    # Note: With nothing installed the check stops at the first tool, gum: "Required UI dependency missing: gum", pointing at task dev:setup-environment.
    # Copy: task glab:auth:ensure
    When the developer runs the auth check straight away
    # Note: With gum in place the check moves on and stops at the next tool, glow: "Required UI dependency missing: glow".
    # Copy: bash .config/gum/install.sh && task glab:auth:ensure
    When the developer installs gum and re-runs the check
    # Note: With gum and glow in place the check clears the UI tools and stops at the CLI: the "GitLab CLI not found" box tells you to install glab.
    # Copy: bash .config/glow/install.sh && task glab:auth:ensure
    When the developer adds glow and re-runs, leaving only the CLI missing
    # Note: Every tool is installed but no GitLab sign-in yet; CI=true takes the non-interactive path: "GitLab authentication required", pointing at task glab:auth.
    # Copy: task glab:install && CI=true task glab:auth:ensure
    When the developer installs the CLI and re-runs it in CI mode, still not signed in
    # Chapter: The check reads the right GitLab host
    # Note: A throwaway project whose remote points at a self-hosted GitLab host — a company running its own GitLab — with gum, glow and glab installed but no sign-in yet. The card shows the remote.
    # Copy: git remote -v
    Given a self-hosted GitLab project with the tools installed but no sign-in yet
    # Note: CI mode takes the non-interactive path: "GitLab authentication required", naming the exact self-hosted host it read from the remote.
    # Copy: CI=true task glab:auth:ensure
    Then the check reads the self-hosted GitLab host straight from the remote
    # Note: The origin is switched to an SSH-style gitlabssh.* URL — the address a self-hosted GitLab gives out for SSH clones. The card shows the new remote.
    # Copy: git remote set-url origin git@gitlabssh.selfhosted-corp.example:acme/widgets.git
    When the same project instead uses an SSH-style gitlabssh remote
    # Note: The gitlabssh.* remote is turned back into its gitlab.* API host: the message names gitlab.selfhosted-corp.example and never the ssh name.
    # Copy: CI=true task glab:auth:ensure
    Then the check turns it back into the gitlab API host
    # Chapter: init names the exact fix, then bows out cleanly
    # Note: A throwaway project whose only link to GitLab is a remote the CLI never signed into. Set up off-camera: a fresh Ubuntu box with the toolbox and this git remote.
    # Copy: git remote -v
    Given a developer's new project points at a GitLab remote the CLI never signed into
    # Note: init installs its tools, reaches the sign-in check and stops with "GitLab authentication required", pointing at task glab:auth.
    # Copy: task devsecops:init
    Then init stops and prints the exact GitLab sign-in command to run
    # Note: A new project whose remote points at github.com — a non-GitLab host init must never push to. The card shows the remote.
    # Copy: git remote -v
    When another developer's project points at a GitHub remote instead
    # Note: init finds no GitLab remote and stops with "No GitLab repository remote was detected.", giving the exact git remote set-url line to fix it.
    # Copy: task devsecops:init
    Then init refuses the non-GitLab remote and shows how to fix it
    # Note: TASK_GLAB_ENABLED=false makes every glab step skip, so init reaches "DevSecOps project initialization completed" and never asks about sign-in.
    # Copy: TASK_GLAB_ENABLED=false task devsecops:init
    Then init finishes cleanly once the GitLab integration is turned off
