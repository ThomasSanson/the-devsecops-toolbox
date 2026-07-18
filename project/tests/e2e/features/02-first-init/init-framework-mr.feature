@e2e @e2e-journey @e2e-init-framework-mr
Feature: Developer journey — init delivers the framework through a review, never a forced push
  As a developer setting up the DevSecOps Toolbox
  I want the installer to start main and open an init-framework-devsecops
  merge request I can review, then set up the GitLab project
  So that the framework reaches main through a review, never pushed straight in

  # Each scenario is a STORYBOARD: ONE human sentence = ONE card = ONE pixel
  # baseline, asserted inside the step (tolerance: 0), so a visual regression
  # fails on the exact sentence whose image drifted. The storyboard SVG —
  # selectable, copyable text around the untouched frames, including the command
  # that replays the scenario — is assembled automatically when the scenario
  # ends. The Given closes the off-camera stage (lambda user, cloned terminal,
  # staged installer, glab auth) with its visual proof; each Then pairs its page
  # frame with a programmatic REST assert of the SAME fact, so a regression fails
  # loud even without eyes. The four scenarios share the feature file; each keys
  # its own per-tag baseline folder, so a parallel worker never shares a capture.

  # Case A — the blank project: init bootstraps main with a minimal README, opens
  # the framework MR, then configures the GitLab project (protection, tokens,
  # CI/CD variable, fast-forward merges). This is the flagship journey and also
  # the establishing shot of the blank onboarding.
  @e2e-init-framework-mr-blank
  Scenario: init opens the framework merge request and configures a blank project
    Given a developer has just cloned a brand-new empty project from GitLab
    When the developer runs the toolbox installer on the blank project
    And the installer sets up the framework and says the setup is done
    Then init has opened a merge request into main for review
    And main now sits next to the init-framework-devsecops branch
    And init now lets main accept only fast-forward merges
    And init has blocked direct pushes to main
    And init has created the automation access token
    And init has saved the token as a CI/CD variable

  # Case B — main already exists and the developer is on it: init still branches
  # from main into init-framework-devsecops and opens the MR, never pushing to main.
  @e2e-init-framework-mr-existing-main
  Scenario: init still routes through a merge request when main already exists
    Given a developer has cloned a project that already has a main branch
    When the installer finishes setup on the project that already had main
    Then init has opened the merge request into the main that already existed
    And GitLab lists main next to the init-framework-devsecops branch

  # Case C — main exists but the developer is on a spike branch: init must branch
  # from main (not the current branch) into init-framework-devsecops.
  @e2e-init-framework-mr-other-branch
  Scenario: init branches from main even when the developer is on a spike branch
    Given a developer is working on an experiment branch instead of main
    When the installer finishes setup while on the experiment branch
    Then init started the framework branch from main, not from the experiment branch
    And GitLab shows only main and the framework branch, never the local experiment branch

  # Disable flag — TASK_DEVSECOPS_INIT_DIRECT=true skips the merge-request
  # delivery entirely: no init-framework-devsecops branch, no merge request; only
  # the bootstrap README reaches main and the framework stays in the local tree.
  @e2e-init-framework-mr-direct
  Scenario: the direct-delivery flag ships the bootstrap straight to main, no merge request
    Given a developer has set the installer to deliver straight to main
    When the installer finishes setup in direct-delivery mode
    Then init has sent the starter README to main with no merge request
    And the project's main holds only the starter README
