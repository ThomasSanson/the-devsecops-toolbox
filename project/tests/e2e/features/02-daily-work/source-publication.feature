@e2e
Feature: Publishing the source of a private project, without the parts that must stay private
  As a team whose project lives in a private repository but whose source has to
  be public
  I want the pipeline to publish that source on its own, at every release, minus
  the files we decided never leave
  So that the obligation is met without anyone being one command away from
  making the wrong file public

  @publication-contracts
  Scenario: Publication keeps its safety promises from source selection to repeated releases
    # Chapter: Source bytes that can be copied safely
    # Note: The real Git repository contains an approved source file. A local smudge filter would substitute uncommitted text during a checkout. These fixture contracts run the shipped tasks against disposable repositories and a fixture approval API; the separate journey below uses GitLab itself.
    Given an approved source file with a local smudge filter
    # Note: The export command must succeed, and the exported file must equal the committed bytes exactly. The card reads that exported file.
    # Copy: task project:test:publication:export
    Then export keeps the committed bytes despite the local smudge filter

    # Note: Both .gitignore and src/message.txt are tracked and approved. The ignore pattern also matches the source file.
    Given an approved tracked source file also matched by its ignore file
    # Note: The public Git tree and file contents must match the manifest. The card reads that tree and the published blob.
    # Copy: task publication:publish
    Then publication includes every approved tracked path despite ignore rules

    # Note: The tracked and approved path is -public/message.txt. The leading dash is part of its name.
    Given an approved source path whose directory starts with a dash
    # Note: The export must succeed and preserve every byte. A directory name must not become an option passed to a shell utility.
    # Copy: task project:test:publication:export
    Then export preserves a path that starts with a dash

    # Note: The Git index records src/host with symlink mode 120000. Its target is outside the repository.
    Given a candidate source entry that is a symbolic link
    # Note: The dry run must return a failure and name src/host. No public commit may result from this check.
    # Copy: task publication:check
    Then the dry run names and rejects the symbolic link

    # Note: The committed source file contains a Git LFS pointer, whose blob is displayed here.
    Given a candidate source file that contains an LFS pointer
    # Note: The dry run must fail and name src/large.txt because the pointer is not the large file's source content.
    # Copy: task publication:check
    Then the dry run names and rejects the LFS pointer

    # Note: The prepared commit deletes denylist.base. Git shows the deletion before the check runs.
    Given a source commit missing the framework denylist
    # Note: The dry run must fail and name denylist.base. An absent framework safety floor is a configuration error.
    # Copy: task publication:check
    Then the dry run refuses a missing framework denylist

    # Note: The displayed test wrappers make Git cat-file blob exit 73 and record every scanner invocation. The publication scan setting is required.
    Given a Git blob reader that fails before scanning
    # Note: The task must fail, the scanner invocation log must remain empty, and the public repository must contain zero commits. These wrappers test failure ordering; they do not test scanner detection.
    # Copy: task publication:publish
    Then publication stops before scanning or pushing when export fails

    # Note: The Git reader works through export. The scanner fixture records success, then the reader fails while the public index is being built. The displayed scripts define this exact fault.
    Given a Git blob reader that fails after a successful scan
    # Note: A successful scan cannot turn a later read error into an empty published file. The scan log has one entry and the public repository must still have zero commits.
    # Copy: task publication:publish
    Then publication stops before pushing when a post-scan blob read fails

    # Chapter: Publication starts only when requested
    # Note: TASK_PUBLICATION_ENABLED is false in the task's actual environment.
    Given a publication explicitly disabled at runtime
    # Note: The task must report that publication is disabled, make zero fixture API calls, and leave the public repository empty.
    # Copy: task publication:publish
    Then disabled publication neither contacts the forge nor creates a public commit

    # Note: This local fixture sets CI=true and TASK_PUBLICATION_ON=manual without CI_JOB_MANUAL. It exercises the runtime guard; it is not a GitLab job.
    Given an automatic job environment configured for manual publication
    # Note: The command must exit successfully with a manual-mode explanation and leave zero public commits.
    # Copy: task publication:publish
    Then an automatic job does not publish in manual mode

    # Note: This local fixture sets CI=true and TASK_PUBLICATION_ON=tag without CI_COMMIT_TAG.
    Given a branch job environment configured for tag publication
    # Note: The command must exit successfully and leave zero public commits. Actual job creation remains part of GitLab CI configuration.
    # Copy: task publication:publish
    Then a branch job does not publish in tag mode

    # Note: The source ref and manifest are available in the local repository.
    Given a locally available source ready for an offline check
    # Note: The dry run must succeed while the fixture API request log remains empty. Approval verification happens when publishing.
    # Copy: task publication:check
    Then the dry run succeeds without contacting the forge

    # Note: The requested ref is absent. The origin points to the local HTTP fixture so an attempted fetch would be recorded.
    Given an offline check whose source ref is absent locally
    # Note: The check must fail and make zero HTTP requests. Offline checking must not repair an absent ref by accessing the network.
    # Copy: task publication:check
    Then the dry run refuses the absent ref without fetching it

    # Note: TASK_PUBLICATION_SCAN is set to done, the removed caller-controlled bypass.
    Given a publication given an unsupported scan-done flag
    # Note: The task must fail and leave zero public commits. The supported modes are required and off.
    # Copy: task publication:publish
    Then publication refuses a caller assertion that scanning is done

    # Chapter: Approval identifies the exact manifest
    # Note: The fixture API returns an owner-resolved spelling discussion. Its actual response is shown beside the manifest blob hash.
    Given an owner-resolved discussion unrelated to publication
    # Note: Publishing must fail and leave zero public commits. The owner's identity alone cannot turn another discussion into publication approval.
    # Copy: task publication:publish
    Then an unrelated discussion cannot approve publication

    # Note: The discussion names a manifest hash made of zeroes. The current manifest has a different Git blob hash; both remain visible without masking.
    Given an owner-resolved publication discussion for another manifest
    # Note: Publishing must fail and leave zero public commits. The Publication-manifest marker must identify the exact manifest being published.
    # Copy: task publication:publish
    Then a stale manifest signature cannot approve publication

    # Note: The prepared manifest is current, but the existing discussion is unrelated. The response and manifest hash are displayed.
    Given an unchanged manifest with no publication sign-off
    # Note: The approval task must succeed and send a POST to the discussions endpoint. The captured request log shows that request.
    # Copy: task publication:approve
    Then approval can request an owner signature for the unchanged manifest

    # Note: A new candidate path needs approval. The displayed fixture configuration returns HTTP 403 for every API request.
    Given an approval API that refuses every request
    # Note: The approval task must return a failure. The card contains its actual error output and the recorded requests.
    # Copy: task publication:approve
    Then approval reports failure when the forge refuses its request

    # Note: A new candidate path needs approval. The fixture API accepts other calls but refuses POST requests to discussions.
    Given an approval API that refuses the sign-off thread
    # Note: The task must fail when creation of the approval thread is refused. The recorded requests show where the flow stopped.
    # Copy: task publication:approve
    Then approval reports failure when its sign-off thread cannot be created

    # Chapter: Credentials and setup failures remain visible
    # Note: The test wrappers forward to the real tools while recording their arguments. Credentials are disposable fixture strings.
    Given publication tools that record their process arguments
    # Note: Publishing must succeed, and neither source nor target token may occur in the recorded argument list. The displayed searches return zero matches.
    # Copy: task publication:publish
    Then publication keeps both credentials out of process arguments

    # Note: The target URL deliberately includes a disposable username and token. The setup card shows this test input.
    Given a publication target URL containing a fixture credential
    # Note: The check must fail, and the command output must not contain the fixture URL token. The result card displays only actual command output and Git checks.
    # Copy: task publication:check
    Then the dry run refuses the credential URL without printing its token

    # Note: The fixture API offers an existing token and refuses creation of a replacement.
    Given setup whose replacement-token request is refused
    # Note: Setup must fail without deleting the existing token or enabling publication in .env.dist. The recorded requests make the absence of token deletion visible.
    # Copy: task publication:init
    Then setup preserves the current token when its replacement fails

    # Note: The fixture API refuses POST and PUT requests to CI variables.
    Given setup whose CI-variable update is refused
    # Note: Setup must fail without deleting a working variable or revoking the token still used by CI. The request log is the evidence for those assertions.
    # Copy: task publication:init
    Then setup preserves the working variable and token after an update failure

    # Note: The local source is on onboarding. The fixture API exposes main as the project's default branch.
    Given setup started from an onboarding branch
    # Note: Setup must succeed, enable only_allow_merge_if_all_discussions_are_resolved, and schedule main. The captured API request bodies are inspected for both settings.
    # Copy: task publication:init
    Then setup enables the discussion gate and schedules the default branch

    # Chapter: Releases preserve tags and history
    # Note: The source has tag 1.0.0. The next command sequence publishes it, creates a second source release with identical public bytes, and retries that release.
    Given a first source release ready for repeated publication
    # Note: Both tags must exist and the public history must contain exactly two commits after the retry. The card shows the real tag list and commit counts at each check.
    # Copy: task publication:publish
    Then unchanged public bytes retain later releases without duplicating retries

    # Note: The source has tag 1.0.0. The command sequence publishes it, reserves public tag 1.0.1, then attempts a different source release with that same tag.
    Given a first source release ready for a later public tag collision
    # Note: The second publication must fail and the public main ref must retain its previous commit. The real ref reads expose that equality.
    # Copy: task publication:publish
    Then a conflicting public tag prevents the branch from moving

    # Note: The source has no tag. The sequence publishes it, adds tag 1.0.0 to that same source commit, and publishes again.
    Given an untagged source commit ready for publication
    # Note: The public tag must point to the original public commit and the public history must still contain exactly one commit. The card displays the real ref and history checks.
    # Copy: task publication:publish
    Then a tag added later points to the existing public commit

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
    # Note: Nobody typed a command. The approval is what changed, and the pipeline noticed on its own.
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
