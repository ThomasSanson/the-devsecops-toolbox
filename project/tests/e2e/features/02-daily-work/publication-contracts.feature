@e2e
Feature: Publishing the source of a private project, without the parts that must stay private
  As a team whose project lives in a private repository but whose source has to
  be public
  I want the pipeline to publish that source on its own, at every release, minus
  the files we decided never leave
  So that the obligation is met without anyone being one command away from
  making the wrong file public

  # The publication's safety promises, one at a time, typed into a real
  # terminal on throwaway Git repositories. GitLab's API is played by
  # fixture-forge, a stand-in this test controls, because a real GitLab cannot
  # refuse one request on demand. The last chapter publishes to a real public
  # project on GitLab. Every card is twinned with a check of the same fact.
  @publication-contracts
  Scenario: Publication keeps its safety promises from source selection to repeated releases
    # Chapter: Exactly the committed files, or nothing
    # Note: A real Git repository built for this story, in a real terminal. Git tracks src/message.txt, the file to publish, even though the ignore file, .gitignore, matches it: the last chapter comes back to that.
    # Note: The allowlist lets src/ and .gitignore leave, the manifest says both were approved, and publication-owner is the one person who may approve. The .env file holds the settings: source-public.git, an empty public repository next door, two throwaway tokens, and fixture-forge, the stand-in for GitLab's API. Every other repository in this story is a copy of this one with one thing changed, and its own public repository.
    # Copy: tail -n +1 .gitignore .config/publication/allowlist .config/publication/manifest .config/publication/owners .env
    Given a throwaway source repository whose files are approved for publication
    # Note: This copy adds -public/message.txt, in a folder whose name starts with a dash, which a careless shell command would read as an option. It also sets a smudge filter, a local Git setting that rewrites a file when Git writes it to disk: the working copy of src/message.txt says UNCOMMITTED CONTENT.
    # Note: The export writes what would be published into ../snapshot and prints 3, the number of files. Both files there hold the committed text: the filter changed nothing, and the dash folder arrived whole. The task is this repository's own name for the line below, which any project with the publication can run.
    # Copy: sh .config/publication/publish.sh export ../snapshot && tail -n +1 ../snapshot/*/message.txt
    Then export copies the committed bytes, past a local smudge filter and into a folder whose name starts with a dash
    # Note: Three copies, three commits the publication cannot copy faithfully. src/host is a symbolic link (Git mode 120000). src/large.txt is a Git LFS pointer, a small text file standing in for a large one. The third commit deletes denylist.base, the framework's own list of files that never leave.
    # Note: task publication:check, the dry run, refuses all three and names the file each time, instead of listing it as publishable.
    # Copy: task publication:check
    And the dry run names and refuses a symbolic link, an LFS pointer and a missing framework denylist
    # Chapter: Publication runs only when asked, and only after a real scan
    # Note: Three runs of task publication:publish, each told not to publish: switched off with TASK_PUBLICATION_ENABLED=false, then two runs that look like a CI job (CI=true) set to publish only from a manual job, or only from a tag pipeline. Each says why in one line and stops.
    # Note: The last two commands check both sides: the public repository has 0 commits, and the stand-in forge received 0 requests.
    # Copy: TASK_PUBLICATION_ENABLED=false task publication:publish
    Then publication does nothing when it is switched off, or when CI starts it outside its manual or tag job
    # Note: In this copy, origin, the address Git fetches from, points at the stand-in forge: a fetch would show up in its request log. The dry run lists the 2 files it would publish, and says the owner's signature is only checked when publishing.
    # Note: Asked for a branch that does not exist, it answers No such ref instead of fetching it. The request log is still empty.
    # Copy: TASK_PUBLICATION_SOURCE_REF=absent task publication:check
    And the dry run never contacts the forge: it passes offline and refuses an absent ref instead of fetching it
    # Note: TASK_PUBLICATION_SCAN=done is not a mode: nobody can tell the publication that the secret scan already happened. It refuses.
    # Note: The next two copies put a stand-in git, printed on the card, and a stand-in scanner, which writes one line to scan.log when it runs, ahead of the real tools. In export-fails, every read of a file's contents fails: the publication stops before the scan, which never ran (0 lines in scan.log). In index-fails, the reads fail only after the scan passed (1 line): the publication still stops, and says Nothing was pushed. Both public repositories have 0 commits.
    # Copy: TASK_PUBLICATION_SCAN=done task publication:publish
    And publication refuses to skip the secret scan, and stops before the push when Git cannot read a file
    # Chapter: Approval names the exact list
    # Note: For this copy, the stand-in forge answers with the three threads of discussions.json, all resolved by publication-owner. One is about spelling. One names a manifest of zeros, an older list. One names this manifest, the hash on the first line, but its question was edited after it was resolved: updated_at comes after resolved_at.
    # Note: None of them counts, so task publication:publish refuses: the approved list carries no owner signature. task publication:approve then asks again on merge request !1, and the request log ends with the POST that asks the new question.
    # Copy: task publication:approve
    Then only an owner's answer that names the current manifest and was not edited afterwards approves publication, and approval asks the owner again
    # Note: This copy adds src/new.txt, a file nobody approved, so task publication:approve has to open a merge request. The stand-in forge is told to refuse every API request, then only the POST of the sign-off thread.
    # Note: Both runs fail and say so: The forge refused the approval request. Nothing was approved. The request log marks each refusal 403, the code a forge answers when it refuses. The first run is refused from its first request and gives up at the fourth, when it tries to commit the new list. The second run gets as far as the very last request, the POST of the sign-off thread.
    # Copy: task publication:approve
    And approval fails loudly when the forge refuses every request, or only the sign-off thread
    # Chapter: Tokens and setup failures stay safe
    # Note: Here git, curl, sed and jq are stand-ins that write every argument they receive to argv.log, then run the real tool. The publication succeeds. The log holds the clone and the push, and neither throwaway token from .env: grep counts 0.
    # Note: The last command puts a token inside the public repository's URL. The dry run refuses that URL, and its answer does not repeat the token.
    # Copy: TASK_PUBLICATION_TARGET_URL=https://fixture-url-token@example.invalid/public.git task publication:check
    Then neither token shows up, in process arguments or in the refusal of a target URL that carries one
    # Note: task publication:init is the one-time setup. It asks two questions, answered with Enter, then replaces the project's token and stores the new one in two CI/CD variables. The stand-in forge refuses the new token, then, on the second run, the update of the variables.
    # Note: Both runs fail. The first says why. The second only shows the refused request. The request log has no DELETE: the token CI still uses was not revoked, and no variable was deleted. .env.dist records the destination, but publication is not switched on.
    # Copy: task publication:init
    And setup keeps the working token and CI variables when the forge refuses their replacement
    # Note: This copy sits on a branch called onboarding. Setup succeeds, and its own lines say what it changed: GitLab now requires all discussions to be resolved before merging, and a nightly schedule runs on main, not on onboarding.
    # Note: The request log tells the same story, and one more thing: the old token is deleted only after its replacement is stored.
    # Copy: task publication:init
    And setup started from an onboarding branch turns on the discussion gate and schedules the main branch
    # Chapter: Releases on a real public project on GitLab
    # Note: The last copy publishes to a real public project on the test GitLab, empty until now. Its ignore file still matches src/*.txt.
    # Note: The publication is approved, pushes 2 files, and names the release after the source commit, since no tag exists yet.
    # Copy: task publication:publish
    When the first release is published to an empty public project on GitLab
    # Note: GitLab's page for src/message.txt in the public project. The Files panel lists .gitignore and src/message.txt, the two approved files, and the file holds the committed text. Its one commit, publish <source-commit-1>, was made by DevSecOps Toolbox.
    # Note: The ignore file did not hold it back: the publication copies what Git tracks, whatever a working copy would ignore.
    # Copy: http://gitlab/<lambda-user>/<project>/-/blob/main/src/message.txt
    Then the public project holds every approved file, even one its ignore file matches
    # Note: The developer tags the commit already published as 1.0.0: the public repository is already up to date, so only the tag is added. Then an empty commit tagged 1.0.1, with the same files: it gets its own public commit. Publishing 1.0.1 again changes nothing.
    # Copy: git tag 1.0.0 && task publication:publish
    When a tag is added to that release later, then a new release with the same files is published twice
    # Note: GitLab's Tags page of the public project, sorted by name. 1.0.0 sits on the first commit, still named after the source commit it published. 1.0.1 sits on its own commit, publish 1.0.1.
    # Note: Two tags on two commits: the late tag made no commit, and the retry added nothing.
    # Copy: http://gitlab/<lambda-user>/<project>/-/tags?sort=name_asc
    Then the late tag sits on the commit already published, and the new release has its own commit and tag
    # Note: Somebody has tagged the public project 1.0.2 by hand on GitLab, on its current commit: the first command lists it. The developer then changes the source and tags it 1.0.2 as well.
    # Note: The publication refuses: the public tag 1.0.2 already identifies another commit. It pushes nothing, so the main branch of the public project is on <public-commit-2> before and after.
    # Copy: git ls-remote http://gitlab/<lambda-user>/<project>.git main 1.0.2
    And a public tag that already names another commit stops the next release, and the main branch stays where it was
