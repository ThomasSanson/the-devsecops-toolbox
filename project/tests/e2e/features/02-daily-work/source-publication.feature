@e2e
Feature: Publishing the source of a private project, without the parts that must stay private
  As a team whose project lives in a private repository but whose source has to
  be public
  I want the toolbox to publish that source to a public project on its own, at
  every release, minus the files we decided never leave
  So that the obligation is met without anyone being one command away from
  making the wrong file public

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
  # This story runs the REAL commands in a REAL terminal against a REAL GitLab:
  # the private project, the public one it publishes to, and the merge request
  # the toolbox opens when the list changes. ONE sentence = ONE card = ONE pixel
  # baseline (tolerance: 0), and every card is twinned with a check of the same
  # fact so a regression fails loud even without eyes.
  @source-publication
  Scenario: The source reaches the public project only after an owner approved the exact list of files
    # Chapter: What would leave the private project
    # Note: The project on GitLab, with a padlock next to its name: it is private, and nobody outside the team can open this page. That is deliberate, because the repository holds deployment files and a key that must never be public.
    # Note: The source itself, though, has to be published. Look at the file list: the project's own src/ sits next to deploy/ and the framework's files. Some of it may leave, some of it must not, and the whole story is about telling the two apart.
    # Copy: http://gitlab/<lambda-user>/<project>
    Given a private project whose source has to be published somewhere public
    # Note: Two files decide what may leave. The allowlist names what is allowed to be published: the README at the root, and everything under src/. Whatever it does not name never leaves, so deploy/ stays private without anyone having to say so.
    # Note: The denylist takes files back out of that set, and it always wins. Here it holds one line, src/internal/, because that folder sits inside the allowed src/ and must not go out with it.
    # Note: The leading slash matters. These are gitignore patterns, where a name on its own matches at any depth: plain "README.md" would also publish every README buried in a subfolder. "/README.md" means this project's own, and nothing else.
    # Copy: head -n 12 .config/publication/allowlist .config/publication/denylist
    When the developer opens the two files that decide what may be published
    # Note: The toolbox answers with the exact list. Three files would be published, and they are named one by one — this is the list a human is meant to read before anything becomes public.
    # Note: Under it, the two files the allowlist had matched and something took back. src/certs/service.key was caught by the framework floor, a list the toolbox ships and a project cannot empty: a private key never leaves, whatever the allowlist says. src/internal/customer-keys.js was caught by the project's own denylist.
    # Copy: task publication:check
    Then the toolbox names every file that would become public, and the ones it holds back
    # Chapter: Nothing leaves until somebody has said yes
    # Note: The release runs on the main branch, and the publication step runs at the end of it. It stops on the spot: three paths would become public for the first time, and it names all three.
    # Note: The reason is the last line. Nobody has approved that list. The toolbox will not publish a file just because a pattern matched it; a person has to have looked at the list first.
    # Copy: task release
    When the developer runs the release on the main branch
    # Note: The public project, the one the source is published to, as GitLab shows it right now. It is empty. Not one file was pushed.
    # Note: That is the point of the refusal. Once a file is public it stays public: people clone, forks exist, search engines keep a copy. So the toolbox stops before the push, never after it.
    # Copy: http://gitlab/<lambda-user>/<project>-public
    Then the public project is still empty
    # Note: Instead of publishing, the toolbox opened a merge request on the private project, and it did the asking for you: the description names the owners so GitLab notifies them, and the question is left open as a thread.
    # Note: The box at the bottom is GitLab's own: "Merge blocked", and the reason under it, all threads must be resolved. Until somebody ticks that thread, this merge request cannot go in. That part is enforced by GitLab itself, on the free tier, with no paid feature involved.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    And the toolbox opens a merge request asking the owners to approve the list
    # Note: The Changes tab is where the decision actually gets made. One file changed, .config/publication/manifest, with three added lines, and those three lines are exactly the three paths that would become public.
    # Note: So approving is reading a diff of file names. Nothing to install, nothing to run: whoever reviews this sees the publication itself, line by line.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1/diffs
    And the merge request shows the exact list of paths that would become public
    # Chapter: The right person has to be the one who says yes
    # Note: The developer ticks the thread themselves and merges. GitLab is satisfied: the merge request went in, and the page now reads Merged.
    # Note: That is as far as GitLab goes on the free tier. It makes sure somebody answered the question. It has no way to require that the somebody was one of the people the project trusts with this decision.
    # Copy: http://gitlab/<lambda-user>/<project>/-/merge_requests/1
    When the developer answers the question themselves and merges the merge request
    # Note: The release runs again, and the publication step refuses again. This time it says why in one line: the list was approved by "lambda", and lambda is not one of the owners.
    # Note: Under it, the toolbox names the file that decides, .config/publication/owners, and who is in it. GitLab checks that the box was ticked; the toolbox checks who ticked it. That second check is the one that makes the sign-off mean something.
    # Copy: task release
    Then the release still refuses, and names the person who answered
    # Note: So the owner reopens the question on GitLab and answers it themselves. Here the toolbox reads that answer back: the list on the main branch is approved, and the name on it is the owner's.
    # Note: Nothing else moved. Same list, same three files, same merge request. The only thing that changed is who put their name on it.
    # Copy: task publication:check
    When an owner reopens the question on GitLab and answers it instead
    # Note: The release runs a third time, and this time the publication goes through. It says what it did: three files published, two withheld, pushed to the public project.
    # Note: This is the same command a developer runs from their own machine and the same one the pipeline runs on the main branch. There is no separate mode and no special machine: the release publishes, or it refuses, identically in both.
    # Copy: task release
    Then the release publishes the approved files, and only them
    # Note: The public project now carries the source: README.md and src/. This page is readable by anyone, which is the whole purpose, and the one commit on it is called publish 1.4.0.
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
    # Note: A developer adds src/server/token-store.js and commits it. No list changed: the allowlist has said src/ for weeks, so this new file matches it and would be published on the next release.
    # Note: The release refuses, and names that one file. This is the accident the manifest exists for, and it has nothing to do with editing a list: a file simply landed in a folder that was already public.
    # Copy: task release
    When a developer adds a new file inside a folder that is already published
    # Note: The published src/ folder, the same page as three cards ago, unchanged. token-store.js is not there, and neither is anything else nobody approved.
    # Note: Which closes the story back on its first rule: what gets published is what an owner approved, file by file, and never what a pattern happened to match.
    # Copy: http://gitlab/<lambda-user>/<project>-public
    Then the public project has not moved
    # Chapter: The pipeline is what publishes, not a person
    # Note: The developer pushes, and GitLab takes it from there. This project's pipeline carries the publication job the toolbox ships, on the main branch, in the release stage: the source leaves from CI, not from somebody's laptop.
    # Note: The job failed, and the reason is the one from three cards ago, word for word. GitLab runs the same script a developer runs, so it stops at the same place: src/server/token-store.js is on nobody's approved list, and nothing was pushed.
    # Note: Which is what makes the rule real. A developer can be talked into skipping a step; the pipeline cannot, and it is the pipeline that holds the token.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<id>
    When the branch is pushed and GitLab runs the publication itself
    # Note: An owner answered the thread on the merge request the job left behind, and it went in. The same pipeline runs again on the same branch, and this time the job is green: four files published, two withheld.
    # Note: Nobody typed a command to publish. The approval is what changed, and the pipeline noticed on its own.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<id>
    Then the pipeline publishes the source on its own, once an owner has approved
    # Note: The published src/server folder, with the file that was held back until an owner said yes. It is here now, and it got here without anybody being able to push it by hand.
    # Note: And the two files that never leave are still not here. Same rules, same result, whether the publication runs on a laptop or in CI.
    # Copy: http://gitlab/<lambda-user>/<project>-public/-/tree/main/src
    And the public project carries exactly what the owner approved
    # Chapter: A secret in a published file stops everything
    # Note: A developer commits staging mailer credentials into src/app.js, a file that has been public for two releases. No list changes: the file was already allowed, and its new content would go out with the next publication.
    # Note: The pipeline's first job is the one that reads what would become public. It found the password, and it says where — file, line, and the rule that caught it. This is betterleaks, the same scanner the code phase runs, pointed at the snapshot instead of at the repository.
    # Copy: http://gitlab/<lambda-user>/<project>/-/jobs/<id>
    When a secret is committed into a file that is already published
    # Note: The pipeline, seen whole. The scan is red and the publication below it never started: it waits on the scan, so a secret cannot be published by a job that simply ran next.
    # Note: That is the point of a separate job. Approval answers "may this file be public"; the scan answers "is there a secret in it", and both have to be yes.
    # Copy: http://gitlab/<lambda-user>/<project>/-/pipelines/<id>
    Then the publication never ran, and the public project still holds what it held
