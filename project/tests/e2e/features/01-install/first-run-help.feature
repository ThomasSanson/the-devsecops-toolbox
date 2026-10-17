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
    # Chapter: The check names what is missing, and the command that installs it
    # Note: A copy of the toolbox on a fresh machine. Its git remote points at the company's own GitLab, gitlab.selfhosted-corp.example.
    # Note: The toolbox needs three tools: gum, glow and glab, the GitLab command line tool. None of them is installed yet, and the shell answers "command not found" for each.
    # Copy: git remote -v; gum --version; glow --version; glab --version
    Given a developer's project points at the company's own GitLab, with none of the toolbox's tools installed yet
    # Note: The developer runs the GitLab check. It stops at the first tool it misses: "Required UI dependency missing: gum", and the run ends on "Failed to run task".
    # Note: It names the command to run, task dev:setup-environment, the setup that installs every tool the toolbox needs. Off camera, a machine that already has gum gets the same advice for glow, and one that has both is told to install glab.
    # Copy: task glab:auth:ensure
    When the developer runs the GitLab check, it names the missing tool and the setup that installs it
    # Chapter: The check reads the right GitLab host
    # Note: The developer runs task dev:setup-environment, then the check again. The setup installs every tool, a long run that scrolls off the screen, so the card starts at its last line, "Development environment setup completed successfully".
    # Note: Nobody has signed in yet, so the check shows "GitLab Authentication Required". "Target Host: gitlab.selfhosted-corp.example" is the host it read from the git remote. Below it, the check asks "Continue and sign in now?", and waits for Yes or No.
    # Copy: task dev:setup-environment && task glab:auth:ensure
    When the developer runs that setup, the check names the company's GitLab host and offers to sign in
    # Note: The developer answered No, and now points the remote at the address the company's GitLab gives for SSH clones. git remote -v shows git@gitlabssh.selfhosted-corp.example.
    # Note: The check still says "Target Host: gitlab.selfhosted-corp.example". It turns the gitlabssh name back into the gitlab one, the address where you sign in.
    # Copy: git remote set-url origin git@gitlabssh.selfhosted-corp.example:acme/widgets.git && git remote -v && task glab:auth:ensure
    Then an SSH-style gitlabssh remote still leads the check to the same GitLab host
    # Note: Now the remote points at github.com. The check stops at once with "No GitLab repository remote was detected." It never asks to sign in.
    # Note: It prints the exact line that points the remote back at GitLab, git remote set-url origin https://gitlab.com/<namespace>/<project>.git, and then task devsecops:init.
    # Copy: git remote set-url origin https://github.com/acme/widgets.git && git remote -v && task glab:auth:ensure
    Then a GitHub remote is refused, with the exact command to point it back at GitLab
    # Chapter: init names the exact fix, then bows out cleanly
    # Note: The developer follows that advice with gitlab.com and runs init. It first runs the same setup again, which finds every tool already installed. The card starts at the last line of that setup, "Development environment setup completed successfully".
    # Note: Then init reaches its GitLab step and shows the same sign-in card, now for "Target Host: gitlab.com". The developer answers No, and init pauses with the two commands to run, "task glab:auth" and then "task devsecops:init".
    # Copy: git remote set-url origin https://gitlab.com/acme/widgets.git && task devsecops:init
    When the developer points the remote back at GitLab and runs init, it stops at the sign-in and names the command to run
    # Note: A project that stays on GitHub has no GitLab to sign in to. It turns the GitLab part of the toolbox off with TASK_GLAB_ENABLED=false and runs init on its GitHub remote.
    # Note: Most of the card is init checking every tool again and finding each one already installed. Versions show as X.Y.Z. Then init skips its GitLab step: the task runner says devsecops:init:configure "is up to date". It ends on "DevSecOps project initialization completed", with no sign-in question and no refusal of the remote.
    # Copy: git remote set-url origin https://github.com/acme/widgets.git && TASK_GLAB_ENABLED=false task devsecops:init
    Then a project that stays on GitHub turns the GitLab integration off, and init finishes cleanly
