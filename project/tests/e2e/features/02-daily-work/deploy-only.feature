@e2e
Feature: A merge request that only changes deployment files does not wait for the test suite
  As a maintainer shipping a new version to production
  I want the test suite skipped when my merge request only moves image tags
  So that a deployment does not wait fourteen minutes for tests that cannot catch anything

  # Shipping a version is often a merge request that changes four lines: the
  # image tags in a deployment folder. No application code, no test, nothing a
  # test could catch, and the pipeline still runs the whole test suite.
  #
  # A project can now name its deployment folders in one setting,
  # TASK_DEVSECOPS_TEST_DEPLOY_PATHS. The test job asks one script, the one this
  # story runs, before it starts the suite. The answer is "skip" only when every
  # file the merge request changes sits in one of those folders. Any other
  # answer, and any doubt, runs the suite exactly as before.
  #
  # The setting can also name single files, for a project that wants its
  # overlay and not the whole folder around it. The build and deploy jobs, which
  # boot the whole project too, ask the same script and end green the same way.
  #
  # Every card is a real terminal in a throwaway project: one line is typed, and
  # the whole screen it leaves is the card. The line ends on the script the test
  # job runs, with the variable GitLab hands a merge request pipeline.
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
    # Note: The script says "The test suite runs: TASK_DEVSECOPS_TEST_DEPLOY_PATHS is empty." and ends on exit code 1, which tells the test job to run the suite.
    # Copy: grep '^TASK_DEVSECOPS_TEST_DEPLOY_PATHS=' .env.dist; CI_MERGE_REQUEST_DIFF_BASE_SHA=$(git rev-parse main) bash .config/devsecops/scripts/check-deploy-only.sh; echo "exit code $?"
    Then with no deployment folder named, the test suite runs as before
    # Note: The main branch now names the two folders in .env.dist, as the first line shows. The same merge request still changes one file, the production overlay.
    # Note: This time the script says "Only deployment files changed (project/kustomize project/argocd): the test suite is skipped." and ends on exit code 0. The test job ends there, green, in seconds.
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
    # Chapter: The build and deploy jobs ask the same question
    # Note: The test job is not the only one that boots the whole project: the build and deploy jobs do too. The grep shows the three jobs calling the same script, the build and deploy jobs with their own name.
    # Note: The build job's line, run on the release, says "Only deployment files changed (...): the build job is skipped." and ends on exit code 0. The build job ends there, green, and so does the deploy job.
    # Copy: grep -h 'bash .config/devsecops/scripts/check-deploy-only.sh' .config/gitlab/ci/devsecops/build.yml .config/gitlab/ci/devsecops/test.yml .config/gitlab/ci/devsecops/deploy.yml; CI_MERGE_REQUEST_DIFF_BASE_SHA=$(git rev-parse main) bash .config/devsecops/scripts/check-deploy-only.sh 'build job'; echo "exit code $?"
    Then the build and deploy jobs ask the same script and skip the same way
