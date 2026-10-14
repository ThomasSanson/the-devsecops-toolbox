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

  # Some projects have to live in a private repository and, at the same time,
  # publish their source. Copying it by hand is how a deployment secret ends up
  # on the internet, and the forge's own mirroring is no help: it copies
  # everything, history included, with no way to leave a file out.
  #
  # So the toolbox publishes a filtered snapshot instead. Two files in the
  # repository decide what may leave: an allowlist and a denylist, where the
  # denylist always wins. A third file, the manifest, records the exact list of
  # paths somebody has already approved, and nothing is ever published that is
  # not in it.
  #
  # This story is told the way a team lives it: on GitLab. A real private
  # project, a real public one, a project-scoped runner, and the real pipeline
  # doing the publishing. Every card is a page or a job log a reviewer can open
  # for themselves. ONE Gherkin sentence = ONE card = ONE pixel baseline
  # (tolerance: 0), and every card is twinned with a REST check of the same fact.
  @source-publication
  Scenario: The source reaches the public project only after an owner approved the exact list of files
    # Chapter: What would leave the private project
    # Note: The project on GitLab, with a padlock next to its name: it is private, and nobody outside the team can open this page. That is deliberate, because the repository holds deployment files and a key that must never be public.
    # Note: The source itself, though, has to be published. Look at the file list: the project's own src/ sits next to deploy/ and the framework's files. Some of it may leave, some of it must not, and the whole story is about telling the two apart.
    # Copy: http://gitlab/<lambda-user>/<project>
    Given a private project whose source has to be published somewhere public
    # Note: The file that decides what is allowed to leave, as GitLab shows it. It names the README at the root and everything under src/. Whatever it does not name never leaves, so deploy/ stays private without anyone having to say so.
    # Note: The leading slash matters. These are gitignore patterns, where a name on its own matches at any depth: plain "README.md" would also publish every README buried in a subfolder.
    # Copy: http://gitlab/<lambda-user>/<project>/-/blob/main/.config/publication/allowlist
    When a reviewer opens the file that says what may be published
    # Note: And the file that takes files back out of that set, which always wins. One line, src/internal/, because that folder sits inside the allowed src/ and must not go out with it.
    # Note: Beside it, denylist.base is the framework's own floor: private keys, .env files, terraform state. A project can add to it by writing its own denylist, never take from it.
    # Copy: http://gitlab/<lambda-user>/<project>/-/blob/main/.config/publication/denylist
    And the file that takes files back out of it, which always wins
    # Chapter: Nothing leaves until somebody has said yes
    # Note: The pipeline on the main branch, and the job that publishes. It stopped on the spot: three paths would become public for the first time, and it names all three.
    # Note: The reason is the last line. Nobody has approved that list. The pipeline will not publish a file just because a pattern matched it; a person has to have looked at the list first.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<id>
    Then the pipeline refuses to publish a list nobody approved
    # Note: The public project, the one the source is published to, as GitLab shows it right now. It is empty. Not one file was pushed.
    # Note: That is the point of the refusal. Once a file is public it stays public: people clone, forks exist, search engines keep a copy. So the pipeline stops before the push, never after it.
    # Copy: http://gitlab/<lambda-user>/<project>-public
    And the public project is still empty
    # Note: Instead of publishing, the job opened a merge request on the private project, and it did the asking for you: the description names the owners so GitLab notifies them, and the question is left open as a thread.
    # Note: The box at the bottom is GitLab's own: "Merge blocked", and the reason under it, all threads must be resolved. Until somebody ticks that thread, this merge request cannot go in. That part is enforced by GitLab itself, on the free tier, with no paid feature involved.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    And the job opens a merge request asking the owners to approve the list
    # Note: The Changes tab is where the decision actually gets made. One file changed, .config/publication/manifest, with three added lines, and those three lines are exactly the three paths that would become public.
    # Note: So approving is reading a diff of file names. Nothing to install, nothing to run: whoever reviews this sees the publication itself, line by line.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1/diffs
    And that merge request shows the exact list of paths that would become public
    # Chapter: The right person has to be the one who says yes
    # Note: The developer ticks the thread themselves and merges. GitLab is satisfied: the merge request went in, and the page now reads Merged.
    # Note: That is as far as GitLab goes on the free tier. It makes sure somebody answered the question. It has no way to require that the somebody was one of the people the project trusts with this decision.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    When the developer answers the question themselves and merges it
    # Note: The merge started the pipeline again, and the job refuses again. This time it says why in one line: the list was approved by "lambda", and lambda is not one of the owners.
    # Note: Under it, the job names the file that decides, .config/publication/owners, and who is in it. GitLab checks that the box was ticked; the toolbox checks who ticked it. That second check is the one that makes the sign-off mean something.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<id>
    Then the pipeline still refuses, and names the person who answered
    # Note: So an owner reopens the question on GitLab and answers it themselves. The thread now carries their name, on the same merge request, with the same list.
    # Note: Nothing else moved. Same three files, same paths. The only thing that changed is who put their name on it.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    When an owner reopens the question and answers it instead
    # Note: The pipeline runs once more and this time the publication goes through. The job says what it did: approved by the owner, three files published, two withheld, pushed to the public project.
    # Note: The test starts a new pipeline on the same commit after the owner answers. The job checks the current approval before publishing.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<id>
    Then the pipeline publishes the approved files, and only them
    # Note: The public project now carries the source: README.md and src/. This page is readable by anyone, which is the whole purpose, and the one commit on it is named after the release.
    # Note: What is not here matters as much. There is no deploy/ folder, because the allowlist never named it.
    # Copy: http://gitlab/<lambda-user>/<project>-public
    And the public project now carries the source, without the files that never leave
    # Note: Inside the published src/ folder: app.js and the server code, and nothing else.
    # Note: The internal folder and the private key are not here, and never were. They were filtered out before the push, not deleted after it, so they were never public for a second.
    # Copy: http://gitlab/<lambda-user>/<project>-public/-/tree/main/src
    And the folders that were held back are not inside it either
    # Note: The whole history of the public project: one commit, named after the release, authored by the toolbox rather than by a person.
    # Note: That is the shape by design. Each release adds exactly one commit, so the public history reads as a publication log, and a file that was held back was never in it to be found later.
    # Copy: http://gitlab/<lambda-user>/<project>-public/-/commits/main
    And the published history is one commit for that release
    # Chapter: A file nobody approved does not slip through
    # Note: A developer pushes src/server/token-store.js to main. No list changed: the allowlist has said src/ for weeks, so this new file matches it and would be published by the next pipeline.
    # Note: The job refuses, and names that one file. This is the accident the manifest exists for, and it has nothing to do with editing a list: a file simply landed in a folder that was already public.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<id>
    When a developer pushes a new file inside a folder that is already published
    # Note: The published src/ folder, the same page as three cards ago, unchanged. token-store.js is not there, and neither is anything else nobody approved.
    # Note: Which closes the loop back on the first rule: what gets published is what an owner approved, file by file, and never what a pattern happened to match.
    # Copy: http://gitlab/<lambda-user>/<project>-public/-/tree/main/src
    Then the public project has not moved
    # Chapter: A secret in a published file stops everything
    # Note: A developer commits staging mailer credentials into src/app.js, a file that has been public since the first release. No list changes: the file was already allowed, and its new content would go out with the next publication.
    # Note: The pipeline's first job is the one that reads what would become public. It found the password, and it says where: file, line, and the rule that caught it. This is betterleaks, the same scanner the code phase runs, pointed at the snapshot instead of at the repository.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<id>
    When a secret is committed into a file that is already published
    # Note: The pipeline, seen whole. The scan is red and the publication below it never started: it waits on the scan, so a secret cannot be published by a job that simply ran next.
    # Note: That is the point of a separate job. Approval answers "may this file be public"; the scan answers "is there a secret in it", and both have to be yes.
    # Copy: http://gitlab/<lambda-user>/<project>/-/pipelines/<id>
    Then the publication never ran, and the public project still holds what it held
