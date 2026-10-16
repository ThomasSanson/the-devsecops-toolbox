@e2e
Feature: the framework repairs its own GitLab setup when something breaks it
  As a maintainer relying on the toolbox
  I want `task devsecops:init` to fix its own GitLab setup, the project access
  tokens and the CI/CD variables that carry them, whatever happened behind its
  back, and `task devsecops:reload` to put a project that drifted back to what
  its own answers describe
  So that one command always leaves a working setup in place.

  # ONE story in six chapters. Chapters 1 to 5 share one project, set up by a
  # first `task devsecops:init`. Chapter 6 has its own project, generated from
  # the template so the reload has answers to read. ONE Gherkin sentence = ONE
  # card = ONE pixel baseline, asserted inside the step (tolerance: 0), and every
  # card is a real GitLab page: the access tokens, the CI/CD variables, the
  # protected branches or a commit.
  #
  # The release token is TASK_COMMITIZEN_TOKEN, the token the release job pushes
  # with. The other token on the access-tokens page, TASK_RENOVATE_TOKEN, belongs
  # to the dependency robot. A CI/CD variable of the same name holds each token
  # for the pipeline. Each card is paired with a check of the same fact: REST on
  # the tokens, the variables, the branch and the commits, a sign-in to GitLab
  # with each variable's value, and the lines the command printed. What changes on every run is
  # masked: dates, last use, addresses, commit ids, the pipeline, and the secret
  # part of each token.
  #
  # Chapter 1: init rebuilds a revoked release token, and a second init changes
  # nothing. Chapter 2: one more init repairs a planted duplicate and a tampered
  # variable. Chapters 3 to 5 each break one more thing a page check would miss:
  # the variable holds a real token, but not the release token; the release
  # token cannot push; the variable is no longer masked, then no longer
  # protected. init repairs each one, and in chapter 5 it keeps the token,
  # because the token itself was right. Chapter 6: a project that drifted the
  # way a live one does is put back by one `task devsecops:reload`, which also
  # replaces both tokens even though they still worked, and leaves the
  # project's own settings alone. init leaves a working token alone, as
  # chapters 1 and 5 show: that is the difference between the two commands.
  @self-healing
  Scenario: init heals a revoked, duplicate, wrong or weakened token and an unguarded variable, and reload puts a drifted project back
    # Chapter: A revoked release token is rebuilt
    # Note: GitLab's access-tokens page of a project after its first `task devsecops:init`. That run created two tokens, the release token TASK_COMMITIZEN_TOKEN and the dependency robot's TASK_RENOVATE_TOKEN.
    # Note: Someone has since revoked the release token in GitLab. "Active project access tokens" lists only TASK_RENOVATE_TOKEN, and the release token sits under "Inactive project access tokens", marked "Revoked". Dates, last use and expiry change on every run, so they are blanked.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/access_tokens
    Given a project the framework set up, whose release token someone then revoked in GitLab
    # Note: The developer runs `task devsecops:init` again. "Active project access tokens" lists TASK_COMMITIZEN_TOKEN once more: a new token, while the old one stays below, still "Revoked".
    # Note: The same run stored the new token in the CI/CD variable of the same name. The test checks that this variable, like the dependency robot's, signs in to GitLab as its own active token.
    # Copy: task devsecops:init
    When the developer runs the framework's init again, a brand-new release token takes the revoked one's place
    # Note: A second `task devsecops:init` on the healed project. The page has not changed: the same release token is active, and "Inactive project access tokens" still holds one row. The init run found a working token and left it alone.
    # Copy: task devsecops:init
    When the developer runs init a second time, GitLab keeps that release token and revokes nothing
    # Chapter: A duplicate token and a tampered variable are repaired
    # Note: The same project. Someone creates a second token named TASK_COMMITIZEN_TOKEN in GitLab, so "Active project access tokens" now lists two release tokens where there should be one.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/access_tokens
    When someone plants a second release token with the same name in GitLab
    # Note: Someone also overwrites the release token's CI/CD variable. The project's CI/CD settings, values revealed (the button now reads "Hide values"): TASK_COMMITIZEN_TOKEN now holds "tampered-by-e2e", which no pipeline can sign in with.
    # Note: TASK_RENOVATE_TOKEN still holds a real token. It starts with "glpat-" like every GitLab token, and its secret part is masked as "*****".
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/ci_cd
    And someone overwrites the release token's CI/CD variable with a bad value
    # Note: One more `task devsecops:init`. "Active project access tokens" lists a single release token again, and "Inactive project access tokens" now holds three.
    # Note: The first is the token revoked in chapter 1. The second is the older of the two duplicates, which the init run revoked. The third is the one it kept, which it then replaced with a new token because the CI/CD variable no longer matched it.
    # Copy: task devsecops:init
    When the developer runs the framework's init once more, a single release token is left
    # Note: The same CI/CD settings page, values revealed. TASK_COMMITIZEN_TOKEN holds a GitLab token again, "glpat-" with its secret part masked, where it held "tampered-by-e2e". The test checks that this value signs in to GitLab as the new release token.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/ci_cd
    Then the CI/CD variable holds a GitLab token again instead of the bad value
    # Chapter: A variable that signs in as another token is fixed
    # Note: The same CI/CD settings, values revealed. Someone pasted the dependency robot's token into the release token's variable, so TASK_COMMITIZEN_TOKEN and TASK_RENOVATE_TOKEN now hold the same value.
    # Note: Nothing on this page gives it away. Both read "glpat-*****" and both keep their "Protected" and "Masked" badges, because the value is a real token that signs in to GitLab. The test checks that it signs in as the dependency robot's token, not as the release token.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/ci_cd
    When someone pastes the dependency robot's token into the release token's CI/CD variable
    # Note: One more `task devsecops:init`. It asks GitLab which token the variable signs in as. The answer is not the release token, so init replaced the release token with a new one and stored that one in the variable.
    # Note: "Inactive project access tokens" now counts 4: the replaced release token joined the three from chapters 1 and 2. TASK_RENOVATE_TOKEN is still the same token, and the test checks that each variable signs in as its own token again.
    # Copy: task devsecops:init
    When the developer runs init again, it replaces the release token the variable did not sign in as
    # Chapter: A release token that cannot push is rebuilt
    # Note: Someone revoked the release token, made a new TASK_COMMITIZEN_TOKEN by hand and stored it in the variable. Its "Scopes" column reads only "api". It lacks "write_repository", the right to push to the repository, which the release job needs.
    # Note: "Inactive project access tokens" counts 5 with the token revoked by hand. The new token signs in and the variable holds it, so only its scopes give it away.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/access_tokens
    When someone swaps the release token for one that cannot push to the repository
    # Note: One more `task devsecops:init`. It compared the token's scopes with the ones it needs, revoked the hand-made token and created a new one. The active TASK_COMMITIZEN_TOKEN reads "api, write_repository" again, and "Inactive project access tokens" counts 6, with the hand-made token, the row that reads only "api", among them.
    # Note: The same run stored the new token in the CI/CD variable. The test checks that the variable signs in as it.
    # Copy: task devsecops:init
    When the developer runs init again, the release token can push to the repository again
    # Chapter: A variable that lost its guards gets them back, with the same token
    # Note: The CI/CD settings again. Someone turned masking off on TASK_COMMITIZEN_TOKEN. Under its name the "Masked" badge is gone, and only "Protected" and "Expanded" are left. Masked means GitLab hides the value in every job log.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/ci_cd
    When someone turns masking off on the release token's CI/CD variable
    # Note: Someone also turned protection off. Only "Expanded" is left under TASK_COMMITIZEN_TOKEN. Protected means only pipelines on protected branches, such as the main branch, can read the value.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/ci_cd
    And someone turns protection off on that variable as well
    # Note: One more `task devsecops:init`. TASK_COMMITIZEN_TOKEN shows "Protected" and "Masked" again, like TASK_RENOVATE_TOKEN below it. Its value still reads "glpat-*****", and the test checks that it is the very same token as before.
    # Copy: task devsecops:init
    When the developer runs init again, the variable is masked and protected again
    # Note: The access-tokens page after that run looks exactly as it did at the end of the previous chapter: one active release token, and "Inactive project access tokens" still counts 6. The token was right, so init fixed the variable's settings and replaced nothing.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/access_tokens
    Then GitLab still lists the same release token, because init replaced nothing
    # Chapter: A project that drifted is put back in one command
    # Note: A new project, generated from the toolbox and set up on install day. Its repository settings, "Protected branches": the main branch says "Allowed to push and merge: Maintainers".
    # Note: The toolbox sets that to "No one", so every change reaches the main branch through a merge request. Someone loosened it by hand.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/repository
    Given a project the framework set up, whose main branch someone then loosened by hand
    # Note: Four files hold a few lines from the toolbox and everything else from the project: .env.dist, .env.dev, the MegaLinter settings .config/megalinter/config.yml and the Trivy ignore list .config/trivy/trivyignore.yml.
    # Note: GitLab's page for the commit "chore: add the project's own settings": four changed files, with one green line of the project's own added at the end of each.
    # Copy: git commit -am "chore: add the project's own settings" && git push origin main
    And the project added its own settings to .env.dist, .env.dev, the MegaLinter settings and the Trivy ignore list
    # Note: That loosening lets someone push a hand edit straight to the main branch. GitLab's page for the commit "chore: tweak the pipeline by hand": one changed file, .gitlab-ci.yml, with one green line added at its end, "# a hand-edited line the toolbox never wrote".
    # Copy: git commit -am "chore: tweak the pipeline by hand" && git push origin main
    And someone pushed a hand edit of the pipeline file straight to the main branch
    # Note: The developer runs `task devsecops:reload`. It re-applies the project's own answers to the framework files, then redoes the GitLab setup. On the access-tokens page both tokens are active, and both install-day tokens sit under "Inactive project access tokens", marked "Revoked".
    # Note: The reload replaced them even though they still worked, and stored each new token in its CI/CD variable. `task devsecops:init` never replaces a working token, as chapters 1 and 5 showed.
    # Copy: task devsecops:reload
    When the developer reloads the framework, both automation tokens are revoked and replaced by new ones
    # Note: The same "Protected branches" settings as before the reload. The main branch says "Allowed to push and merge: No one" again, and "Allowed to merge: Maintainers": a change now reaches the main branch only through a merge request.
    # Copy: http://gitlab/<lambda-user>/<project>/-/settings/repository
    Then the main branch is locked down again
    # Note: The reload also put .gitlab-ci.yml back on disk, without the hand-written line. The main branch is locked, so the developer commits it on a branch and opens a merge request with the push.
    # Note: GitLab's page for that commit, the same kind of page as the hand edit: "1 merge request", one changed file, .gitlab-ci.yml, and the red line "# a hand-edited line the toolbox never wrote" removed.
    # Note: The four files with the project's own settings are not in the commit: the reload left those lines where the project put them.
    # Copy: git switch -c reload-framework && git commit -am "chore: put the framework files back" && git push -o merge_request.create -o merge_request.target=main origin reload-framework
    And the developer sends the restored pipeline file back through a merge request
