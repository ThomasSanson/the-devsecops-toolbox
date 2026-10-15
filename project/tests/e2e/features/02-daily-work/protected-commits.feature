@e2e
Feature: the framework guards what reaches the repository: clean commits and no secrets
  As a developer using the toolbox
  I want the checks a generated project ships to accept clean commits, turn
  back sloppy ones, and stop committed secrets from ever entering the history
  So that the project's own commit rules and secret scanning actually apply.

  # ONE story, from a teammate's laptop to GitLab. ONE Gherkin sentence = ONE
  # card = ONE pixel baseline, asserted inside the step (tolerance: 0), and
  # every card is twinned with a programmatic check of the same fact (exit
  # code, working tree, REST on the GitLab project), so a regression fails loud
  # even without eyes.
  #
  # The project is ONE real render, published on the test GitLab. It answered
  # that its runners cannot start privileged containers, so every secret scan
  # runs the pinned betterleaks binary (issue #225), on the laptop as in the
  # pipeline. The teammate clones it, turns the hooks on, and every later card
  # runs in that clone: a sloppy message refused then fixed, a key refused by
  # the pre-commit scan, forced in, caught by the branch scan, deleted in vain,
  # then removed from the history. GitLab closes the story with two merge
  # requests and one page shot for both: the cleaned branch is ready to merge,
  # a key hidden in secrets.yaml (issue #182) is blocked by the pipeline, whose
  # log never prints the key. The demo project's pipeline keeps only its
  # code:betterleaks job, untouched; every other job is switched off in its
  # .gitlab-ci.yml before the first push, so each merge request runs exactly
  # the scan the story is about, and its shared before_script starts with
  # exec 2>&1, so the job log keeps the order its lines were written in (the
  # runner reads stdout and stderr apart). The terminal cards are the commands' real
  # output: they run in the test runner, which has no live terminal.
  @protected-commits
  Scenario: the commit checks accept clean work and secrets never reach the main branch
    # Chapter: The hooks come with the setup, not with the clone
    # Note: GitLab's page for lefthook.yml on the main branch of a project generated from the toolbox. It declares the commit hooks.
    # Note: Before each commit, pre-commit runs task betterleaks:protect, a secret scan of the staged files. On each commit message, commit-msg runs task commitlint:lint-message and task commitizen:check-message.
    # Copy: http://gitlab/lambda/e2e-commit-hooks/-/blob/main/lefthook.yml
    Given a project generated from the toolbox sits on GitLab, its commit hooks declared in lefthook.yml on the main branch
    # Note: A teammate clones the project. Git never copies hooks, so ls finds no commit-msg and no pre-commit file in .git/hooks.
    # Note: task dev:setup-environment is the one-time setup every clone runs, and the dev container runs it on build. The ⋮ stands for its toolchain checks. Its last phase installs the hooks: lefthook says "sync hooks: ✔️ (commit-msg, pre-commit)", and ls now finds both files.
    # Copy: git clone http://gitlab/lambda/e2e-commit-hooks.git && cd e2e-commit-hooks && task dev:setup-environment
    When a teammate clones it, task dev:setup-environment turns on the commit hooks git never copies
    # Chapter: Every commit message is checked
    # Note: The teammate writes deploy notes on a new branch. deploy/.gitignore ignores *.pem, so git status marks the deploy key "!!", ignored, and git add stages only the two notes files.
    # Note: The message starts with "deploy:", a type the convention does not know. The pre-commit scan passes with "No secrets detected in staged files.", then commitizen and commitlint both refuse the message. Commitlint lists the types it accepts: "type must be one of [build, chore, ...]". No commit is made.
    # Copy: git commit -m "deploy: add the deploy notes"
    Then the hooks refuse the teammate's first commit, the deploy notes under a sloppy message, with their own explanation
    # Note: The same staged files, with a message that starts with the type "feat:". The scan, commitizen and commitlint all pass, and git records the commit with its 2 files. The key is not one of them.
    # Copy: git commit -m "feat: add the deploy notes"
    And the same commit goes through once its message follows the convention, with the gitignored deploy key left out
    # Chapter: A key is stopped on the laptop
    # Note: The teammate copies the key to the root of the project, out of the folder that ignores it, and stages it. cat shows the fake key in clear.
    # Note: The pre-commit scan finds a private-key in deploy-key.pem and prints "REDACTED" where the key would be. The commit is refused: "❌ Betterleaks detected secrets in your staged files!".
    # Copy: cp deploy/deploy-key.pem . && git add deploy-key.pem && git commit -m "chore: add the deploy key"
    When the teammate stages the deploy key outside its ignored folder, the pre-commit scan refuses the commit
    # Note: git commit --no-verify skips the hooks, as the refusal itself pointed out, and the key is committed.
    # Note: The branch scan reads every commit since the main branch. It names the file and the commit, "chore: add the deploy key", still prints "REDACTED" instead of the key, and blocks the branch.
    # Copy: git commit --no-verify -m "chore: add the deploy key" && task betterleaks:scan-branch
    When the teammate forces the key past the hook, the branch scan blocks the branch and names the commit
    # Chapter: Getting out of a secret block
    # Note: The first reflex: delete the key in a new commit. The pre-commit scan reads only what is staged, and a deletion leaves nothing to read ("scanned ~0 bytes"), so the hooks let the commit through.
    # Copy: git rm deploy-key.pem && git commit -m "chore: remove the deploy key"
    When the teammate only deletes the key file, the hooks let the deletion through
    # Note: The branch has three commits now, and its last version holds no key. The scan still finds it, in the commit "chore: add the deploy key": deleting a file does not take it out of the history.
    # Copy: git log --oneline main.. && task betterleaks:scan-branch
    Then the branch scan still finds the key in the commit that added it
    # Note: task git:clean-secrets removes the file from every commit of the history, not only from the last one. It warns that the operation is destructive and lists its prerequisites. The yes piped into it answers its confirmation question.
    # Note: The branch is rewritten: "Ref 'refs/heads/feature/deploy' was rewritten". The key never left this laptop, so nothing on GitLab needs a force push.
    # Copy: task git:clean-secrets -- deploy-key.pem
    When the teammate rewrites the history with the framework's clean-secrets task
    # Note: One commit is left on the branch, the deploy notes. The same scan as two cards before now passes: "No secrets detected in branch commits."
    # Copy: git log --oneline main.. && task betterleaks:scan-branch
    Then the branch scan comes back clean with the deploy notes still on the branch
    # Chapter: GitLab is the gate nobody can skip
    # Note: The teammate pushes the branch, which opens merge request !1. Its pipeline runs the same branch scan, from the same pinned binary. GitLab shows "Merge request pipeline passed" and "Ready to merge!".
    # Copy: git push -o merge_request.create -o merge_request.target=main origin feature/deploy
    Then the cleaned branch, pushed as a merge request, passes the same scan on GitLab and is ready to merge
    # Note: Another branch, started from the main branch, puts the same fake key in secrets.yaml. The scanner used to skip any file with that name (issue #182). The commit skips the hooks with --no-verify, and the push opens merge request !2.
    # Note: Its Changes tab shows the key in clear: this is what the pipeline has to catch. The test project is deleted when the story ends.
    # Copy: git commit --no-verify -m "chore: keep the production deploy key in secrets.yaml" && git push -o merge_request.create -o merge_request.target=main origin feature/secrets-yaml
    When another branch skips every local check and pushes the key inside a secrets.yaml, a file the scanner used to skip
    # Note: The code:betterleaks job of merge request !2, from "$ task betterleaks:scan-branch" on. The job downloads the pinned binary, checks it ("✅ Checksum verified against the published checksums.txt") and runs it with no container.
    # Note: It finds the private-key in secrets.yaml and prints "REDACTED" where the key would be. Every member of the project can read this log, and the key is not in it.
    # Copy: http://gitlab/lambda/e2e-commit-hooks/-/merge_requests/2/pipelines
    Then the pipeline of that merge request blocks the key from the pinned binary and never prints it
    # Note: The same page as for merge request !1. The pipeline failed, and GitLab says "Merge blocked": this project merges a merge request only when its pipeline passed. The key cannot reach the main branch.
    # Copy: http://gitlab/lambda/e2e-commit-hooks/-/merge_requests/2
    And GitLab refuses to merge it, so the key never reaches the main branch

  # Both scan modes side by side, on the three entry points a developer runs:
  # scan-full (every file), protect (the staged files) and scan-branch (the
  # commits since the main branch). Each card shows the Docker project on the
  # left and the binary project on the right, answering the same command. The
  # binary scans run with no reachable Docker daemon, so a scan that tried to
  # start a container would fail. The complete native output is checked before
  # any display normalization.
  @scanner-log-redaction
  Scenario: a secret is blocked without copying its value into the scan log
    # Chapter: Ordinary work passes in both modes
    # Note: Two projects generated with different install answers. The Docker one keeps the Taskfile default, "docker". The binary one answered that its runners refuse privileged containers, and its .env.dist says TASK_BETTERLEAKS_MODE=binary.
    # Note: Each has a clean commit and a clean staged change, so no scan reads an empty input.
    Given clean framework projects use Docker and binary scanners from their install answers
    # Note: The three scans, in each project. All six print their own "No secrets detected" line.
    # Copy: task betterleaks:scan-full && task betterleaks:protect && task betterleaks:scan-branch
    Then full, staged and branch scans pass on ordinary work in both modes
    # Chapter: A detected value stays out of the log
    # Note: Only a synthetic password is used. One line is committed and a second one is staged, so every scan has a real finding to block.
    When a synthetic password is committed and staged in both projects
    # Note: The full scan finds both lines. Each finding names the rule generic-password, the file and the line, and shows "REDACTED" where the value was.
    # Copy: task betterleaks:scan-full
    Then full scans block the secret and redact its value in both modes
    # Note: The staged scan finds the staged line, line 2, and hides its value the same way.
    # Copy: task betterleaks:protect
    And staged scans block the secret and redact its value in both modes
    # Note: The branch scan finds the committed line, line 1, in the commit that added it, and hides its value the same way.
    # Copy: task betterleaks:scan-branch
    And branch scans block the secret and redact its value in both modes
