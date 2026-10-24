@e2e
Feature: A merge request that only changes deployment files does not wait for the test suite
  As a maintainer shipping a new version to production
  I want the test suite skipped when my merge request only moves image tags
  So that a deployment does not wait fourteen minutes for tests that cannot catch anything

  # Shipping a version is often a merge request that changes four lines: the
  # image tags in a deployment folder. No application code, no test, nothing a
  # test could catch, and the pipeline still runs the whole test suite.
  #
  # A project names its deployment paths in TASK_DEVSECOPS_TEST_DEPLOY_PATHS.
  # The first scenario preserves the standalone helper for legacy/local callers.
  # Current CI selects its jobs before a runner starts, using the synchronized
  # project variable proved by the following scenarios.
  #
  # The setting can also name single files, for a project that wants its
  # overlay and not the whole folder around it. Every created build, test and
  # deploy job now executes its task without asking the legacy helper again.
  #
  # Every legacy card is a real terminal in a throwaway project: one line is typed, and
  # the whole screen it leaves is the card. The legacy helper receives the diff
  # base that GitLab hands a merge request pipeline.
  #
  # ONE sentence = ONE card = ONE pixel baseline (tolerance: 0); every card is
  # real captured output, twinned in the step with a check of the same fact.
  @deploy-only
  Scenario: The test suite is skipped only when every changed file is a deployment file
    # Chapter: A release that only moves image tags
    # Note: A project keeps its deployment in two folders, project/kustomize and project/argocd, next to its code in project/src and its test in project/tests. The terminal lists them first.
    # Note: This merge request ships version 1.5.0. git diff shows the whole change: the two image tags of the production overlay move from 1.4.0 to 1.5.0, and nothing else.
    # Copy: ls project && git diff main...HEAD
    Given a merge request that changes nothing but an image tag in a deployment folder
    # Note: The setting ships empty in .env.dist, so a project that never heard of it keeps its pipeline as it was. The grep shows the empty line.
    # Note: The script says "The test suite runs: TASK_DEVSECOPS_TEST_DEPLOY_PATHS is empty." and ends on exit code 1, which tells a legacy caller to run the suite.
    # Copy: grep '^TASK_DEVSECOPS_TEST_DEPLOY_PATHS=' .env.dist; CI_MERGE_REQUEST_DIFF_BASE_SHA=$(git rev-parse main) bash .config/devsecops/scripts/check-deploy-only.sh; echo "exit code $?"
    Then with no deployment folder named, the test suite runs as before
    # Note: The main branch now names the two folders in .env.dist, as the first line shows. The same merge request still changes one file, the production overlay.
    # Note: This time the script says "Only deployment files changed (project/kustomize project/argocd): the test suite is skipped." and ends on exit code 0. A legacy caller can stop there.
    # Copy: git show main:.env.dist | grep '^TASK_DEVSECOPS_TEST_DEPLOY_PATHS='; git diff --stat main...HEAD; CI_MERGE_REQUEST_DIFF_BASE_SHA=$(git rev-parse main) bash .config/devsecops/scripts/check-deploy-only.sh; echo "exit code $?"
    Then once the main branch names the deployment folders, the same merge request skips the test suite
    # Chapter: Anything else still runs the test suite
    # Note: The same release also touches a test: git diff lists two files. One of them, project/tests/app.test.js, is outside the deployment folders, and that is enough.
    # Note: The script names that file and the suite runs: exit code 1.
    # Copy: git diff --stat main...HEAD; CI_MERGE_REQUEST_DIFF_BASE_SHA=$(git rev-parse main) bash .config/devsecops/scripts/check-deploy-only.sh; echo "exit code $?"
    Then a merge request that also changes a test runs the test suite
    # Note: A merge request cannot use the setting to skip its own tests. Here it adds project/src to the deployment folders, as the two diff lines show, and changes project/src/app.js in the same push.
    # Note: The script reads the change against the main branch. .env.dist is one of the changed files and sits outside the deployment folders, so the script names it and the suite runs: exit code 1.
    # Copy: git diff main...HEAD -- .env.dist | grep '^[-+]TASK_DEVSECOPS_TEST_DEPLOY_PATHS='; git diff --stat main...HEAD; CI_MERGE_REQUEST_DIFF_BASE_SHA=$(git rev-parse main) bash .config/devsecops/scripts/check-deploy-only.sh; echo "exit code $?"
    Then a merge request that changes the setting itself runs the test suite
    # Chapter: When in doubt, the test suite runs
    # Note: GitLab sets CI_MERGE_REQUEST_DIFF_BASE_SHA only on a merge request pipeline. Without it, on the main branch, on a tag or on a schedule, there is no merge request to compare.
    # Note: This is the same change that skipped the suite two chapters ago. Run without a merge request around it, the script says "this is not a merge request pipeline." and the suite runs: exit code 1.
    # Copy: bash .config/devsecops/scripts/check-deploy-only.sh; echo "exit code $?"
    Then outside a merge request the test suite always runs
    # Note: The diff base points to a commit this clone does not hold, so git cannot say what changed. The script does not guess: it says "cannot compute the diff" and the suite runs, exit code 1.
    # Copy: CI_MERGE_REQUEST_DIFF_BASE_SHA=0000000000000000000000000000000000000000 bash .config/devsecops/scripts/check-deploy-only.sh; echo "exit code $?"
    Then when the change cannot be computed the test suite runs
    # Chapter: A single file, not a whole folder
    # Note: The main branch now names one file instead of two folders: the production overlay, as the first line shows. The merge request is the same release, one file.
    # Note: The script says "Only deployment files changed (project/kustomize/overlays/production/kustomization.yaml): the test suite is skipped." and ends on exit code 0.
    # Copy: git show main:.env.dist | grep '^TASK_DEVSECOPS_TEST_DEPLOY_PATHS='; git diff --stat main...HEAD; CI_MERGE_REQUEST_DIFF_BASE_SHA=$(git rev-parse main) bash .config/devsecops/scripts/check-deploy-only.sh; echo "exit code $?"
    Then once the main branch names a single file, a merge request that only changes that file skips the test suite
    # Note: The same release also adds a file next to the overlay, project/kustomize/overlays/production/ingress.yaml. The setting names the overlay, not its folder, so the new file is not a deployment file.
    # Note: The script names the new file and the suite runs: exit code 1.
    # Copy: git diff --stat main...HEAD; CI_MERGE_REQUEST_DIFF_BASE_SHA=$(git rev-parse main) bash .config/devsecops/scripts/check-deploy-only.sh; echo "exit code $?"
    Then a new file next to the named file runs the test suite
    # Chapter: Legacy callers and current CI
    # Note: The standalone helper still accepts an exported deployment list and can skip a legacy/local caller. Current build, test and deploy jobs execute their tasks whenever GitLab creates them.
    # Copy: grep -h -- '- task ' .config/gitlab/ci/devsecops/build.yml .config/gitlab/ci/devsecops/test.yml .config/gitlab/ci/devsecops/deploy.yml
    Then legacy callers can skip while current CI jobs execute their tasks

  @deploy-only-paths
  Scenario: Deployment paths preserve configuration and test coverage
    # Note: The development override wins over the multiline default list.
    # Copy: cat .env.dist .env.dev
    Given a deployment policy with literal paths and dotenv overrides
    # Note: After checking the override and its empty value, the override file is cleared. The displayed default list produces a reduced pattern after the contract tests pass. Naming project/Taskfile.yml prints a warning and the full-pipeline fallback. Reading the effective list never edits the pipeline YAML.
    # Copy: cat .env.dist .env.dev && task --silent project:test:deployment-only:contract && task --silent devsecops:plan:deploy-only:pattern && TASK_DEVSECOPS_TEST_DEPLOY_PATHS=project/Taskfile.yml task --silent devsecops:plan:deploy-only:pattern
    Then unsafe paths keep the full pipeline and the effective dotenv value is read without writing YAML

  @deploy-only-sync
  Scenario: Plan synchronizes the deployment policy with bounded recovery
    # Note: This isolated GitLab project uses trunk as its default branch and an API-scoped project token.
    # Copy: cat .env.dist
    Given a default branch plan with a project API token and deployment paths
    # Note: The project variable exists, is raw, and is available to merge request pipelines. Repeating plan is a verified no-op.
    # Copy: task plan
    Then plan publishes and verifies the deployment policy in GitLab
    # Note: Synchronization runs on every eligible plan, including after a temporary stale value.
    # Copy: CI_COMMIT_SHA=$(git rev-parse HEAD) task plan
    Then a later default branch plan repairs the policy even without a configuration change
    # Note: A controlled transport and clock exercise API outages, credentials failures and concurrent branch movement. Live API compatibility is proved above.
    # Copy: task --silent project:test:deployment-only:contract TASK_DEPLOY_ONLY_CONTRACT_CASE=sync
    Then temporary failures retry within bounds while obsolete or unauthorized plans cannot write

  @deploy-only-release-order
  Scenario: Default branch release waits for plan even when plan fails
    # Note: These real GitLab jobs preserve the shipped scheduling rules. A controlled barrier replaces plan's work; a fixture release writes a version marker. Two separate runners prevent an accidental queue from proving the wait.
    Given a default branch pipeline with independent plan and release runners
    # Note: The branch stays at the pipeline commit until plan finishes; the version marker then advances it. Retrying an obsolete plan is refused.
    Then release advances the branch only after plan succeeds
    # Note: Plan remains failed. Release still starts after it finishes, preserving when: always.
    Then release also runs after plan fails without hiding that failure
    # Note: The real web pipeline mutation and both existing schedule flags retain the wait. A second plan waits for its resource group, then its obsolete commit cannot synchronize.
    Then web and scheduled pipelines wait too and concurrent plans are serialized
    # Note: An image-only MR has release without plan. A staging tag still excludes release.
    Then release keeps its behavior for merge requests without plan and staging tags

  @deploy-only-variable-selection @deploy-only-lint-scope @deploy-only-pipeline
  Scenario: GitLab creates only the checks needed for a deployment-only merge request
    # Chapter: Choose deployment files once
    # Note: The dotenv file names a folder and one file. A stored project variable lets GitLab decide before starting a runner, without YAML list/source variables.
    # Copy: cat .env.dist
    Given a project whose pipeline names a deployment folder and a single deployment file
    # Note: This is the real GitLab pipeline for an image-tag change. The code checks and release remain; plan, build, test, deploy, operate, monitor and feedback were never created. No runner is registered in this fixture: the cards prove job selection, not job execution.
    Then GitLab creates only code checks and release for the deployment-only merge request
    # Chapter: Any other change keeps the whole pipeline
    # Note: The same merge request now changes application code too. GitLab creates all the jobs again, including code:lizard and no-cheat.
    Then adding application code to the merge request restores the whole pipeline
    # Note: These fixture tasks print execution markers. The shipped build/test/deploy scripts must actually invoke them when the stored fallback keeps all jobs, despite a nonempty local deployment list.
    Then build test and deploy actually execute when the stored policy keeps the full pipeline
    # Note: A failed plan leaves the previous selection active. Repair updates the project variable for new pipelines; already-created job graphs stay unchanged.
    Then a failed synchronization keeps the previous policy until a later plan repairs it
    # Chapter: Preview the effective setting
    # Note: Task reads dotenv precedence and prints the pattern. Empty, unsupported or overlong lists preserve every job; the preview never writes YAML.
    # Copy: task --silent devsecops:plan:deploy-only:pattern
    Then the effective deployment setting can be previewed without editing the pipeline
    # Chapter: Check only the changed files
    # Note: The deployment file contains an unfinished YAML list. This is the only file changed by the merge request.
    When a merge request contains a malformed deployment file
    # Note: The project now gives only code:megalinter a runner. Its real log lists one changed file; unchanged application code is not scanned.
    Then MegaLinter checks only the changed deployment file
    # Note: The YAML validator names the deployment file and its syntax error. The job fails: checking fewer files still rejects invalid deployment configuration.
    Then MegaLinter rejects the malformed deployment YAML
    # Note: Fixing the changed YAML passes despite the unchanged broken Python file. The same job log now shows successful YAML validation.
    Then fixing only the deployment YAML passes without scanning unchanged Python
    # Note: A mixed MR brings the Python file back into the full scan and reports its syntax error.
    Then a mixed Python change restores its syntax check
    # Note: Checkov reports "Container should not be privileged" for the changed Pod. Its SARIF report identifies CKV_K8S_16 and the deployment file.
    Then the reduced security scan rejects a privileged container
    # Note: Changing privileged to false removes the finding and the whole reduced security job succeeds. The same scanner policies remain enabled.
    Then correcting the privileged container passes the reduced security scan
