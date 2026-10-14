@e2e
Feature: On the first run, the toolbox names the exact thing to fix
  As a developer setting up the DevSecOps Toolbox
  I want each check to stop and name the next command to run when something is missing
  So that I am never left guessing what to do next

  # ONE throwaway machine and ONE live terminal for the whole story: each card
  # follows the advice the card before it printed. The GitLab check is
  # `task glab:auth:ensure` and init is `task devsecops:init`. Nobody ever signs
  # in, so nothing reaches a GitLab server and every card is the terminal: one
  # typed line (the card's Copy) and its whole answer, in real colours.
  # ONE Gherkin sentence = ONE card = ONE pixel baseline, asserted inside the
  # step (tolerance: 0), and every card is twinned with a check of the same fact:
  # the screen text, and for the GitLab host the non-interactive branch of the
  # same check (the one CI takes), run off camera.
  @first-run-help
  Scenario: Every check stops and names the fix, and init finishes cleanly once GitLab is turned off
    # Chapter: The check names each missing tool
    # Note: A copy of the toolbox on a fresh machine. Its git remote points at the company's own GitLab, gitlab.selfhosted-corp.example.
    # Note: The toolbox needs three tools: gum, glow and glab, the GitLab command line tool. None of them is installed yet, and the shell answers "command not found" for each.
    # Copy: git remote -v; gum --version; glow --version; glab --version
    Given a developer's project points at the company's own GitLab, with none of the toolbox's tools installed yet
    # Note: The developer runs the GitLab check three times and installs only the tool it names in between. The first run stops at "Required UI dependency missing: gum", the second at glow.
    # Note: With both installed, the third run stops in a box, "GitLab CLI not found", and says to install glab. Each run ends on "Failed to run task". Tool versions show as X.Y.Z.
    # Copy: task glab:auth:ensure; .config/gum/install.sh; task glab:auth:ensure; .config/glow/install.sh; task glab:auth:ensure
    When the developer runs the GitLab check and installs only the tool it names, one at a time
    # Chapter: The check reads the right GitLab host
    # Note: The developer installs glab with task glab:install and runs the check again. Nobody has signed in yet, so the check shows "GitLab Authentication Required".
    # Note: "Target Host: gitlab.selfhosted-corp.example" is the host it read from the git remote. Below it, the check asks "Continue and sign in now?", and waits for Yes or No.
    # Copy: task glab:install && task glab:auth:ensure
    When the developer installs the GitLab CLI, the check names the company's GitLab host and offers to sign in
    # Note: The developer answered No, and now points the remote at the address the company's GitLab gives for SSH clones. git remote -v shows git@gitlabssh.selfhosted-corp.example.
    # Note: The check still says "Target Host: gitlab.selfhosted-corp.example". It turns the gitlabssh name back into the gitlab one, the address where you sign in.
    # Copy: git remote set-url origin git@gitlabssh.selfhosted-corp.example:acme/widgets.git && git remote -v && task glab:auth:ensure
    Then an SSH-style gitlabssh remote still leads the check to the same GitLab host
    # Note: Now the remote points at github.com. The check stops at once with "No GitLab repository remote was detected." It never asks to sign in.
    # Note: It prints the exact line that points the remote back at GitLab, git remote set-url origin https://gitlab.com/<namespace>/<project>.git, and then task devsecops:init.
    # Copy: git remote set-url origin https://github.com/acme/widgets.git && git remote -v && task glab:auth:ensure
    Then a GitHub remote is refused, with the exact command to point it back at GitLab
    # Chapter: init names the exact fix, then bows out cleanly
    # Note: The developer follows that advice with gitlab.com and runs init. It first installs every tool the project needs, a long run that scrolls off the screen, so the card starts at its last line, "Development environment setup completed successfully".
    # Note: Then init reaches its GitLab step and shows the same sign-in card, now for "Target Host: gitlab.com". The developer answers No, and init pauses with the two commands to run, "task glab:auth" and then "task devsecops:init".
    # Copy: git remote set-url origin https://gitlab.com/acme/widgets.git && task devsecops:init
    When the developer points the remote back at GitLab and runs init, it stops at the sign-in and names the command to run
    # Note: A project that stays on GitHub has no GitLab to sign in to. It turns the GitLab part of the toolbox off with TASK_GLAB_ENABLED=false and runs init on its GitHub remote.
    # Note: The card starts on the same line as the card before. This time init skips its GitLab step (the task runner says devsecops:init:configure "is up to date") and goes straight to "DevSecOps project initialization completed". No sign-in question, no refusal of the remote.
    # Copy: git remote set-url origin https://github.com/acme/widgets.git && TASK_GLAB_ENABLED=false task devsecops:init
    Then a project that stays on GitHub turns the GitLab integration off, and init finishes cleanly
